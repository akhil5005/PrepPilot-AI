const { GoogleGenAI } = require("@google/genai");
const { z } = require("zod");
const { zodToJsonSchema } = require("zod-to-json-schema");
const puppeteer = require("puppeteer");

const ai = new GoogleGenAI({
  apiKey: process.env.Gemini_API_Key,
});

const MODEL = "gemini-2.5-flash";

/**
 * @description Pause for the given number of milliseconds.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @description Is this failure worth retrying?
 *
 * Rate limits (429) and Google-side outages (500/503) are transient, as is an
 * empty body, which is usually the model having run out of output budget.
 * A rejected key or a malformed request will fail identically every time, so
 * retrying those only makes the user wait longer for the same error.
 */
function isTransient(error) {
  const status = error?.status ?? error?.response?.status;

  if (status === 429 || status === 500 || status === 502 || status === 503) {
    return true;
  }

  return Boolean(error?.retryable);
}

/**
 * Call Gemini and return parsed JSON, retrying transient failures.
 *
 * Two settings here are what make this reliable, and both address the cause of
 * the intermittent 500s this replaced:
 *
 * `thinkingBudget: 0` turns off the model's internal reasoning pass.
 * gemini-2.5-flash is a thinking model, and thinking tokens are drawn from the
 * same output budget as the answer. On a long request like the interview
 * report it could spend the entire budget reasoning and return an empty body
 * with finishReason MAX_TOKENS — which is exactly why the same input succeeded
 * one minute and failed the next.
 *
 * `maxOutputTokens` is then set explicitly and generously, so a long but
 * legitimate answer is not cut off mid-JSON.
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {number} options.maxOutputTokens
 * @param {string} options.label Used in log messages.
 * @param {number} [options.attempts]
 * @returns {Promise<object>} the parsed JSON response
 */
async function generateJson({ prompt, maxOutputTokens, label, attempts = 3 }) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const text = response.text;

      if (!text || !text.trim()) {
        const finishReason =
          response?.candidates?.[0]?.finishReason || "UNKNOWN";

        const err = new Error(
          `Gemini returned an empty response (finishReason: ${finishReason})`,
        );
        /* Worth another attempt: usually a truncated or filtered generation. */
        err.retryable = true;
        throw err;
      }

      /*
       * responseMimeType should prevent code fences, but strip them defensively
       * rather than fail the whole request on a stray ```json wrapper.
       */
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");

      let parsed;

      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const err = new Error(
          `Gemini returned a non-JSON response: ${cleaned.slice(0, 200)}`,
        );
        err.retryable = true;
        throw err;
      }

      return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (error) {
      lastError = error;

      const canRetry = attempt < attempts && isTransient(error);

      console.error(
        `[ai] ${label} attempt ${attempt}/${attempts} failed:`,
        error?.message || error,
      );

      if (!canRetry) {
        break;
      }

      /* Exponential backoff: 1s, then 3s. */
      await delay(attempt * 2000 - 1000);
    }
  }

  throw lastError;
}

const interviewReportSchema = z.object({
  matchScore: z
    .number()
    .describe(
      "A score between 0 and 100 indicating how well the candidate's profile matches the job describe",
    ),
  technicalQuestions: z
    .array(
      z.object({
        question: z
          .string()
          .describe("The technical question can be asked in the interview"),
        intention: z
          .string()
          .describe("The intention of interviewer behind asking this question"),
        answer: z
          .string()
          .describe(
            "How to answer this question, what points to cover, what approach to take etc.",
          ),
      }),
    )
    .describe(
      "Technical questions that can be asked in the interview along with their intention and how to answer them",
    ),
  behavioralQuestions: z
    .array(
      z.object({
        question: z
          .string()
          .describe("The behavioral question can be asked in the interview"),
        intention: z
          .string()
          .describe("The intention of interviewer behind asking this question"),
        answer: z
          .string()
          .describe(
            "How to answer this question, what points to cover, what approach to take etc.",
          ),
      }),
    )
    .describe(
      "Behavioral questions that can be asked in the interview along with their intention and how to answer them",
    ),
  skillGaps: z
    .array(
      z.object({
        skill: z.string().describe("The skill which the candidate is lacking"),
        severity: z
          .enum(["low", "medium", "high"])
          .describe("The severity of this skill gap"),
      }),
    )
    .describe("List of skill gaps in the candidate's profile"),
  preparationPlan: z
    .array(
      z.object({
        day: z.number().describe("The day number in the preparation plan"),
        focus: z.string().describe("The main focus of this day"),
        tasks: z.array(z.string()).describe("List of tasks for this day"),
      }),
    )
    .describe("A day-wise preparation plan"),
  title: z.string().describe("The title of the job"),
});

async function generateInterviewReport({
  resume,
  selfDescription,
  jobDescription,
}) {
  const prompt = `
You are an interview preparation expert.

Return ONLY valid JSON.

Use exactly this structure:

{
  "matchScore": number,
  "technicalQuestions": [
    {
      "question": string,
      "intention": string,
      "answer": string
    }
  ],
  "behavioralQuestions": [
    {
      "question": string,
      "intention": string,
      "answer": string
    }
  ],
  "skillGaps": [
    {
      "skill": string,
      "severity": "low" | "medium" | "high"
    }
  ],
  "preparationPlan": [
    {
      "day": number,
      "focus": string,
      "tasks": [string]
    }
  ],
  "title": string
}

Generate:
- matchScore
- 10 technical questions
- 5 behavioral questions
- skill gaps
- 7 day preparation plan

Resume:
${resume || "No resume provided"}

Self Description:
${selfDescription || "No self description provided"}

Job Description:
${jobDescription}
`;

  try {
    /*
     * The report is large — 10 technical questions with model answers, 5
     * behavioural questions, skill gaps and a 7 day plan — so it needs a
     * generous output budget to avoid being truncated mid-JSON.
     */
    return await generateJson({
      prompt,
      maxOutputTokens: 16384,
      label: "interview report",
    });
  } catch (error) {
    /*
     * Surface a message that actually names the cause. The original version
     * replaced every failure with the same sentence, which meant a quota error,
     * a rejected API key and a truncated response were indistinguishable — both
     * in the logs and to the caller — and could not be diagnosed without
     * guessing.
     */
    const status = error?.status ?? error?.response?.status;

    if (status === 429) {
      throw new Error(
        "The AI service is rate limited right now. Please try again in a minute.",
      );
    }

    if (status === 401 || status === 403) {
      throw new Error(
        "The AI service rejected the API key. Check the Gemini key on the server.",
      );
    }

    throw new Error(
      `AI interview report generation failed: ${error?.message || "unknown error"}`,
    );
  }
}

async function generatePdfFromHtml(htmlContent) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();

    await page.setContent(htmlContent, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.addStyleTag({
      content: `
        @page {
          size: A4;
          margin: 12mm 12mm 12mm 12mm;
        }

        body {
          margin: 0;
          padding: 0;
          font-family: Arial, sans-serif;
          font-size: 11px;
          line-height: 1.35;
          color: #111827;
        }

        section,
        .section,
        .project,
        .experience,
        .education {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        h1, h2, h3 {
          margin-top: 6px;
          margin-bottom: 4px;
          break-after: avoid;
          page-break-after: avoid;
        }

        h1 {
          font-size: 24px;
        }

        h2 {
          font-size: 15px;
          border-bottom: 1px solid #d1d5db;
          padding-bottom: 3px;
        }

        h3 {
          font-size: 12px;
        }

        ul {
          margin-top: 3px;
          margin-bottom: 5px;
          padding-left: 16px;
        }

        li {
          margin-bottom: 2px;
          line-height: 1.35;
        }

        p {
          margin-top: 2px;
          margin-bottom: 4px;
        }
      `,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "15mm",
        bottom: "15mm",
        left: "12mm",
        right: "12mm",
      },
    });

    return pdfBuffer;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function generateResumePdf({ resume, selfDescription, jobDescription }) {
  const prompt = `
Generate a professional ATS-friendly resume.

Return ONLY valid JSON in this exact structure:

{
  "html": "complete HTML content here"
}

Candidate Details:

Resume:
${resume || "No resume provided"}

Self Description:
${selfDescription || "No self description provided"}

Target Job Description:
${jobDescription || "No job description provided"}

Rules:
- Create a clean professional resume.
- Keep it simple and ATS friendly.
- Avoid too much design.
- Use proper HTML tags.
- Include sections like Summary, Skills, Projects/Experience, Education if available.
- Do not include markdown.
- Do not include explanations outside JSON.
- The HTML should be complete and directly convertible to PDF.
`;

  try {
    /* Same hardening as the interview report: no thinking, explicit budget,
     * retry on transient failures. A full resume in HTML is smaller than the
     * report, so it needs less room. */
    const jsonContent = await generateJson({
      prompt,
      maxOutputTokens: 8192,
      label: "resume html",
    });

    if (!jsonContent.html) {
      throw new Error("AI did not return resume HTML.");
    }

    const pdfBuffer = await generatePdfFromHtml(jsonContent.html);

    return pdfBuffer;
  } catch (error) {
    const status = error?.status ?? error?.response?.status;

    if (status === 429) {
      throw new Error(
        "The AI service is rate limited right now. Please try again in a minute.",
      );
    }

    throw new Error(
      `AI resume generation failed: ${error?.message || "unknown error"}`,
    );
  }
}

module.exports = {
  generateInterviewReport,
  generateResumePdf,
};

