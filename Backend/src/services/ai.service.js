const { GoogleGenAI } = require("@google/genai");
const { z } = require("zod");
const { zodToJsonSchema } = require("zod-to-json-schema");
const puppeteer = require("puppeteer");

const ai = new GoogleGenAI({
  apiKey: process.env.Gemini_API_Key,
});

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
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        // responseSchema: zodToJsonSchema(interviewReportSchema),
      },
    });

    const text = response.text;

    /*
     * gemini-2.5-flash is a thinking model. If it spends its whole output
     * budget on reasoning, it returns an empty or truncated body with a
     * finishReason of MAX_TOKENS. JSON.parse then fails with a misleading
     * "Unexpected end of JSON input", so check explicitly and report the
     * finishReason, which is what actually explains the failure.
     */
    if (!text || !text.trim()) {
      const finishReason =
        response?.candidates?.[0]?.finishReason || "UNKNOWN";

      throw new Error(
        `Gemini returned an empty response (finishReason: ${finishReason})`,
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `Gemini returned a non-JSON response: ${text.slice(0, 200)}`,
      );
    }

    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (error) {
    /*
     * Log the whole error server side, then surface a message that actually
     * names the cause. The previous version replaced every failure with the
     * same sentence, which meant a quota error, an invalid API key and a
     * truncated response were indistinguishable — both in the logs and to the
     * caller — and the problem could not be diagnosed without guessing.
     */
    console.error("Gemini interview report generation failed:", error);

    /* The @google/genai SDK puts the HTTP status on the error. */
    const status = error?.status ?? error?.response?.status;

    if (status === 429) {
      throw new Error(
        "The AI service quota has been exceeded. Please try again later.",
      );
    }

    if (status === 401 || status === 403) {
      throw new Error(
        "The AI service rejected the API key. Check GEMINI_API_KEY on the server.",
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
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        // Do not use responseSchema here for now.
      },
    });

    const jsonContent = JSON.parse(response.text);

    if (!jsonContent.html) {
      throw new Error("AI did not return resume HTML.");
    }

    const pdfBuffer = await generatePdfFromHtml(jsonContent.html);

    return pdfBuffer;
  } catch (error) {
    console.log("Gemini resume generation failed:", error);

    throw new Error("AI resume generation failed. Please try again later.");
  }
}

module.exports = {
  generateInterviewReport,
  generateResumePdf,
};

