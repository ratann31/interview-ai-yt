const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.RENDER)

async function launchBrowser() {
    if (isProduction) {
        const chromium = require("@sparticuz/chromium").default
        const puppeteer = require("puppeteer-core")

        return puppeteer.launch({
            args: [
                ...chromium.args,
                "--disable-dev-shm-usage"
            ],
            defaultViewport: {
                width: 1280,
                height: 720
            },
            executablePath: await chromium.executablePath(),
            headless: "shell"
        })
    }

    const puppeteer = require("puppeteer")

    return puppeteer.launch({
        headless: true,
        args: [ "--no-sandbox", "--disable-setuid-sandbox" ]
    })
}

function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
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
                    <div class="box">This PDF was generated from your submitted details. Try downloading again later for an AI-polished version.</div>
                    <p class="small">The download keeps working even if the AI service is rate limited or unavailable.</p>
                </div>
            </body>
        </html>
    `
}

async function generatePdfFromHtml(htmlContent) {
    const browser = await launchBrowser()

    try {
        const page = await browser.newPage()
        await page.setContent(htmlContent, { waitUntil: "networkidle0", timeout: 30000 })

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

module.exports = {
    buildFallbackResumeHtml,
    generatePdfFromHtml
}
