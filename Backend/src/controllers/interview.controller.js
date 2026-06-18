const { PDFParse } = require("pdf-parse")
const mammoth = require("mammoth")
const { generateInterviewReport, generateResumePdf } = require("../services/ai.service")
const interviewReportModel = require("../models/interviewReport.model")
const puppeteer = require("puppeteer")


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


function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
}


async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] })
    try {
        const page = await browser.newPage()
        await page.setContent(htmlContent, { waitUntil: "networkidle0" })

        return await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "18mm",
                bottom: "18mm",
                left: "15mm",
                right: "15mm"
            }
        })
    }
    finally {
        await browser.close()
    }
}


function buildFallbackResumeHtml({ title, resume, jobDescription, selfDescription, matchScore }) {
    return `
        <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; color: #111827; padding: 28px; }
                    .header { border-bottom: 2px solid #ec4899; padding-bottom: 14px; margin-bottom: 20px; }
                    .title { font-size: 26px; font-weight: 700; margin: 0; }
                    .meta { color: #6b7280; margin-top: 6px; }
                    .score { display: inline-block; background: #111827; color: #fff; padding: 6px 10px; border-radius: 999px; margin-top: 10px; }
                    .section { margin-top: 18px; }
                    .section h2 { font-size: 16px; margin-bottom: 8px; color: #ec4899; }
                    .box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; white-space: pre-wrap; line-height: 1.55; }
                    .small { font-size: 12px; color: #6b7280; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1 class="title">${escapeHtml(title || "Resume")}</h1>
                    <div class="meta">Generated from your profile and job description</div>
                    <div class="score">Match Score: ${matchScore ?? "N/A"}%</div>
                </div>
                <div class="section">
                    <h2>Profile Summary</h2>
                    <div class="box">${escapeHtml(selfDescription || resume || "No profile text provided.")}</div>
                </div>
                <div class="section">
                    <h2>Target Role</h2>
                    <div class="box">${escapeHtml(jobDescription || "No job description provided.")}</div>
                </div>
                <div class="section">
                    <h2>Resume Notes</h2>
                    <div class="box">AI resume generation was temporarily unavailable, so this PDF was created from your submitted details as a fallback. Try downloading again later for a more polished version.</div>
                    <p class="small">This fallback keeps the download working even if the AI service is rate limited or unavailable.</p>
                </div>
            </body>
        </html>
    `
}




/**
 * @description Controller to generate interview report based on user self description, resume and job description.
 */
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

        let pdfBuffer

        try {
            pdfBuffer = await generateResumePdf({ resume, jobDescription, selfDescription })
        }
        catch (error) {
            const fallbackHtml = buildFallbackResumeHtml({ title, resume, jobDescription, selfDescription, matchScore })
            pdfBuffer = await generatePdfFromHtml(fallbackHtml)
        }

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