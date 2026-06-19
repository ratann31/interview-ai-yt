const { PDFParse } = require("pdf-parse")
const mammoth = require("mammoth")
const { generateInterviewReport, generateResumePdf } = require("../services/ai.service")
const interviewReportModel = require("../models/interviewReport.model")


async function extractResumeText(file) {
    const isDocx = file.originalname?.toLowerCase().endsWith(".docx") || file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    if (isDocx) {
        const result = await mammoth.extractRawText({ buffer: file.buffer })
        return result.value || ""
    }

    const parser = new PDFParse({ data: file.buffer })
    const result = await parser.getText()
    await parser.destroy()

    return result.text || ""
}


async function generateInterViewReportController(req, res) {
    try {
        const { selfDescription = "", jobDescription = "" } = req.body

        if (!jobDescription.trim()) {
            return res.status(400).json({
                message: "Job description is required"
            })
        }

        if (!req.file && !selfDescription.trim()) {
            return res.status(400).json({
                message: "Provide either a resume file or a self description"
            })
        }

        let resumeContent = ""

        if (req.file) {
            try {
                resumeContent = await extractResumeText(req.file)
            }
            catch (error) {
                return res.status(400).json({
                    message: "Unable to read the uploaded resume. Please upload a valid PDF or DOCX file."
                })
            }
        }

        const interViewReportByAi = await generateInterviewReport({
            resume: resumeContent,
            selfDescription,
            jobDescription
        })

        const interviewReport = await interviewReportModel.create({
            user: req.user.id,
            resume: resumeContent,
            selfDescription,
            jobDescription,
            ...interViewReportByAi
        })

        return res.status(201).json({
            message: "Interview report generated successfully.",
            interviewReport
        })
    }
    catch (error) {
        console.error("Failed to generate interview report:", error)
        return res.status(500).json({
            message: "Unable to generate the interview report right now. Please try again."
        })
    }

}

/**
 * @description Controller to get interview report by interviewId.
 */
async function getInterviewReportByIdController(req, res) {
    try {
        const { interviewId } = req.params

        const interviewReport = await interviewReportModel.findOne({ _id: interviewId, user: req.user.id })

        if (!interviewReport) {
            return res.status(404).json({
                message: "Interview report not found."
            })
        }

        res.status(200).json({
            message: "Interview report fetched successfully.",
            interviewReport
        })
    }
    catch (error) {
        console.error("Failed to fetch interview report:", error)
        return res.status(500).json({
            message: "Unable to fetch the interview report right now. Please try again."
        })
    }
}


/** 
 * @description Controller to get all interview reports of logged in user.
 */
async function getAllInterviewReportsController(req, res) {
    try {
        const interviewReports = await interviewReportModel.find({ user: req.user.id }).sort({ createdAt: -1 }).select("-resume -selfDescription -jobDescription -__v -technicalQuestions -behavioralQuestions -skillGaps -preparationPlan")

        res.status(200).json({
            message: "Interview reports fetched successfully.",
            interviewReports
        })
    }
    catch (error) {
        console.error("Failed to fetch interview reports:", error)
        return res.status(500).json({
            message: "Unable to fetch interview reports right now. Please try again."
        })
    }
}


/**
 * @description Controller to generate resume PDF based on user self description, resume and job description.
 */
async function generateResumePdfController(req, res) {
    try {
        const { interviewReportId } = req.params

        const interviewReport = await interviewReportModel.findOne({ _id: interviewReportId, user: req.user.id })

        if (!interviewReport) {
            return res.status(404).json({
                message: "Interview report not found."
            })
        }

        const { resume, jobDescription, selfDescription, title, matchScore } = interviewReport

        const pdfBuffer = await generateResumePdf({
            resume,
            jobDescription,
            selfDescription,
            title,
            matchScore
        })

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename=resume_${interviewReportId}.pdf`
        })

        res.send(pdfBuffer)
    }
    catch (error) {
        console.error("Failed to generate resume PDF:", error)
        return res.status(500).json({
            message: "Unable to generate the resume PDF right now. Please try again."
        })
    }
}

module.exports = { generateInterViewReportController, getInterviewReportByIdController, getAllInterviewReportsController, generateResumePdfController }