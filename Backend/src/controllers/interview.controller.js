const pdfParse = require("pdf-parse");
const {
  generateInterviewReport,
  generateResumePdf,
} = require("../services/ai.service");
const interviewReportModel = require("../models/interviewReport.model");

/**
 * @description Controller to generate interview report based on user self description, resume and job description.
 */
async function generateInterViewReportController(req, res) {
  try {
    const { selfDescription, jobDescription } = req.body;

    if (!jobDescription || !jobDescription.trim()) {
      return res.status(400).json({
        message: "Job description is required.",
      });
    }

    if (!req.file && (!selfDescription || !selfDescription.trim())) {
      return res.status(400).json({
        message: "Either resume or self description is required.",
      });
    }

    let resumeText = "";

    if (req.file) {
      const resumeContent = await pdfParse(req.file.buffer);
      resumeText = resumeContent.text;
    }

    const interviewReportByAi = await generateInterviewReport({
      resume: resumeText,
      selfDescription,
      jobDescription,
    });

    console.log("========== AI OBJECT ==========");
    console.log(JSON.stringify(interviewReportByAi, null, 2));
    console.log("===============================");

    const interviewReport = await interviewReportModel.create({
      user: req.user.id,
      resume: resumeText,
      selfDescription,
      jobDescription,
      ...interviewReportByAi,
    });

    return res.status(201).json({
      message: "Interview Report generated successfully",
      interviewReport,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Failed to generate interview report.",
      error: error.message,
    });
  }
}

/**
 * @description Controller to get interview report by interviewId
 */
async function getInterviewReportByIdController(req, res) {
  try {
    const { interviewId } = req.params;

    const interviewReport = await interviewReportModel.findOne({
      _id: interviewId,
      user: req.user.id,
    });

    if (!interviewReport) {
      return res.status(404).json({
        message: "Interview report not found",
      });
    }

    return res.status(200).json({
      message: "Interview report fetched successfully.",
      interviewReport,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Failed to fetch interview report.",
      error: error.message,
    });
  }
}

/**
 * @description Controller to get all interview reports of logged in user
 */
async function getAllInterviewReportsController(req, res) {
  try {
    const interviewReports = await interviewReportModel
      .find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .select(
        "-resume -selfDescription -jobDescription -__v -technicalQuestions -behavioralQuestions -skillGaps -preparationPlan",
      );

    return res.status(200).json({
      message: "Interview reports fetched successfully.",
      interviewReports,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: "Failed to fetch interview reports.",
      error: error.message,
    });
  }
}

/**
 * @description Controller to generate resume PDF based on user self description, resume and job description.
 */
async function generateResumePdfController(req, res) {
  try {
    const { interviewReportId } = req.params;

    if (!interviewReportId) {
      return res.status(400).json({
        message: "Interview report id is required.",
      });
    }

    const interviewReport = await interviewReportModel.findOne({
      _id: interviewReportId,
      user: req.user.id,
    });

    if (!interviewReport) {
      return res.status(404).json({
        message: "Interview report not found.",
      });
    }

    const { resume, jobDescription, selfDescription } = interviewReport;

    const pdfBuffer = await generateResumePdf({
      resume,
      jobDescription,
      selfDescription,
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename=resume_${interviewReportId}.pdf`,
    });

    return res.send(pdfBuffer);
  } catch (error) {
    console.log(error);

    return res.status(503).json({
      message: "Resume PDF could not be generated right now.",
      error: error.message,
    });
  }
}

module.exports = {
  generateInterViewReportController,
  getInterviewReportByIdController,
  getAllInterviewReportsController,
  generateResumePdfController,
};
