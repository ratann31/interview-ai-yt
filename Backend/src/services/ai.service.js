const { GoogleGenAI } = require("@google/genai")
const { z } = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")
const { buildFallbackResumeHtml, generatePdfFromHtml } = require("../utils/pdf.util")

const ai = process.env.GOOGLE_GENAI_API_KEY
    ? new GoogleGenAI({
        apiKey: process.env.GOOGLE_GENAI_API_KEY
    })
    : null

const MODEL_CANDIDATES = [
    process.env.GOOGLE_GENAI_MODEL,
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-3-flash-preview"
].filter(Boolean)


const interviewReportSchema = z.object({
    matchScore: z.number().describe("A score between 0 and 100 indicating how well the candidate's profile matches the job describe"),
    technicalQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Technical questions that can be asked in the interview along with their intention and how to answer them"),
    behavioralQuestions: z.array(z.object({
        question: z.string().describe("The technical question can be asked in the interview"),
        intention: z.string().describe("The intention of interviewer behind asking this question"),
        answer: z.string().describe("How to answer this question, what points to cover, what approach to take etc.")
    })).describe("Behavioral questions that can be asked in the interview along with their intention and how to answer them"),
    skillGaps: z.array(z.object({
        skill: z.string().describe("The skill which the candidate is lacking"),
        severity: z.enum([ "low", "medium", "high" ]).describe("The severity of this skill gap, i.e. how important is this skill for the job and how much it can impact the candidate's chances")
    })).describe("List of skill gaps in the candidate's profile along with their severity"),
    preparationPlan: z.array(z.object({
        day: z.number().describe("The day number in the preparation plan, starting from 1"),
        focus: z.string().describe("The main focus of this day in the preparation plan, e.g. data structures, system design, mock interviews etc."),
        tasks: z.array(z.string()).describe("List of tasks to be done on this day to follow the preparation plan, e.g. read a specific book or article, solve a set of problems, watch a video etc.")
    })).describe("A day-wise preparation plan for the candidate to follow in order to prepare for the interview effectively"),
    title: z.string().describe("The title of the job for which the interview report is generated"),
})

function normalizeText(value = "") {
    return String(value)
        .replace(/\s+/g, " ")
        .trim()
}

function extractKeywords(text = "") {
    const stopWords = new Set([
        "the", "and", "for", "with", "your", "you", "are", "from", "that", "this",
        "job", "role", "position", "must", "have", "will", "need", "required", "responsibilities",
        "experience", "skills", "skill", "candidate", "team", "work", "using", "ability", "strong",
        "including", "such", "plus", "years", "year", "into", "our", "a", "an", "to", "of",
        "in", "on", "at", "by", "is", "be", "as", "or", "we", "about", "if", "can"
    ])

    return normalizeText(text)
        .toLowerCase()
        .match(/[a-zA-Z][a-zA-Z0-9+.#/-]*/g)?.filter(token => token.length > 2 && !stopWords.has(token)) ?? []
}

function getUniqueKeywords(text = "", limit = 10) {
    return [...new Set(extractKeywords(text))].slice(0, limit)
}

function inferTitle(jobDescription = "") {
    const text = normalizeText(jobDescription)
    const titlePatterns = [
        /(?:role|position|title|opening|hiring for)[:\-]\s*([^\.\n,]{3,80})/i,
        /(?:for|as a)\s+([^\.\n,]{3,80})/i
    ]

    for (const pattern of titlePatterns) {
        const match = text.match(pattern)
        if (match?.[1]) {
            return match[1].replace(/\s+/g, " ").trim().slice(0, 80)
        }
    }

    const firstLine = text.split(/[\.\n]/)[0].trim()
    return firstLine ? firstLine.slice(0, 80) : "Interview Strategy"
}

function buildTechnicalQuestions(roleKeywords) {
    const questionBank = {
        react: {
            question: "How would you design and optimize a React feature for maintainability and performance?",
            intention: "Checks component design, state management, and rendering performance.",
            answer: "Explain component boundaries, data flow, memoization only where needed, and how you would measure and improve performance with profiling."
        },
        typescript: {
            question: "How do you use TypeScript to prevent bugs in a large codebase?",
            intention: "Checks type safety, API design, and code quality discipline.",
            answer: "Talk about strict types, discriminated unions, shared interfaces, and how TypeScript helps catch contract mismatches early."
        },
        node: {
            question: "How would you structure a Node.js backend for scalability and reliability?",
            intention: "Checks backend architecture and production readiness.",
            answer: "Describe modular services, validation, centralized error handling, logging, and resource management for concurrency."
        },
        api: {
            question: "How do you design a clean and resilient API contract?",
            intention: "Checks API design, versioning, and client compatibility.",
            answer: "Discuss clear request and response shapes, status codes, validation, backward compatibility, and safe error messages."
        },
        database: {
            question: "How do you model data and tune database access for growth?",
            intention: "Checks schema design, querying, and performance tradeoffs.",
            answer: "Cover indexing, query shape, normalized versus denormalized data, and how you monitor slow queries and hotspots."
        },
        system: {
            question: "How would you approach a system design problem for this role?",
            intention: "Checks architecture thinking and tradeoff analysis.",
            answer: "Start from requirements, estimate scale, identify the core components, and explain the main bottlenecks and tradeoffs."
        },
        testing: {
            question: "What testing strategy would you use for this feature or service?",
            intention: "Checks quality strategy and test pyramid understanding.",
            answer: "Explain unit tests for logic, integration tests for boundaries, and a small number of end-to-end tests for critical flows."
        },
        cloud: {
            question: "How would you deploy and operate this application in the cloud?",
            intention: "Checks deployment, observability, and operational thinking.",
            answer: "Discuss CI/CD, environment separation, logs, metrics, secrets management, and rollback strategy."
        }
    }

    const selected = []
    for (const keyword of roleKeywords) {
        const match = Object.entries(questionBank).find(([key]) => keyword.includes(key) || key.includes(keyword))
        if (match && !selected.some(item => item.question === match[1].question)) {
            selected.push(match[1])
        }
    }

    while (selected.length < 4) {
        selected.push({
            question: "Can you walk me through a recent project and the tradeoffs you made?",
            intention: "Checks communication, ownership, and practical decision making.",
            answer: "Describe the problem, your role, the constraints, the approach you chose, and the outcome with measurable impact."
        })
        if (selected.length > 6) {
            break
        }
    }

    return selected.slice(0, 5)
}

function buildBehavioralQuestions() {
    return [
        {
            question: "Tell me about a time you had to learn something quickly.",
            intention: "Checks adaptability and learning speed.",
            answer: "Use a short STAR answer that highlights the pressure, how you learned, and the result you delivered."
        },
        {
            question: "Describe a time you disagreed with a teammate or stakeholder.",
            intention: "Checks collaboration and conflict resolution.",
            answer: "Show how you listened, clarified the tradeoff, and kept the discussion focused on the best outcome."
        },
        {
            question: "How do you handle tight deadlines or shifting priorities?",
            intention: "Checks prioritization and execution under pressure.",
            answer: "Explain how you break down work, communicate risk early, and keep the highest-impact tasks moving first."
        }
    ]
}

function buildSkillGaps(roleKeywords) {
    const gaps = [
        { skill: "System design fundamentals", severity: "medium" },
        { skill: "Debugging under pressure", severity: "low" },
        { skill: "Project storytelling", severity: "low" }
    ]

    const keywordMap = {
        react: { skill: "React architecture and state management", severity: "high" },
        typescript: { skill: "Advanced TypeScript", severity: "high" },
        node: { skill: "Node.js backend patterns", severity: "medium" },
        database: { skill: "Database modeling and indexing", severity: "medium" },
        cloud: { skill: "Cloud deployment and operations", severity: "medium" },
        testing: { skill: "Testing strategy", severity: "medium" }
    }

    for (const keyword of roleKeywords) {
        for (const [needle, gap] of Object.entries(keywordMap)) {
            if (keyword.includes(needle) || needle.includes(keyword)) {
                if (!gaps.some(item => item.skill === gap.skill)) {
                    gaps.unshift(gap)
                }
            }
        }
    }

    return gaps.slice(0, 4)
}

function buildPreparationPlan(roleKeywords) {
    const keywordText = roleKeywords.join(" ")

    return [
        {
            day: 1,
            focus: "Role fundamentals",
            tasks: [
                `Review the core requirements from the posting and summarize the top ${Math.min(5, roleKeywords.length || 3)} priorities.`,
                "Revisit recent projects and map them to the role's expected responsibilities.",
                "Prepare a 60-second self-introduction tailored to this role."
            ]
        },
        {
            day: 2,
            focus: "Core technical depth",
            tasks: [
                `Study the main stack areas mentioned in the posting: ${keywordText || "the required technologies"}.`,
                "Practice explaining one technical decision you made and the tradeoffs involved.",
                "Write down common interview questions for these technologies and answer them aloud."
            ]
        },
        {
            day: 3,
            focus: "Problem solving",
            tasks: [
                "Solve a small design or debugging exercise end-to-end.",
                "Review one project for bottlenecks, failure modes, and scaling concerns.",
                "Practice structuring answers with context, action, and result."
            ]
        },
        {
            day: 4,
            focus: "Mock interview practice",
            tasks: [
                "Run a mock interview for both technical and behavioral questions.",
                "Record one answer and refine pacing, clarity, and structure.",
                "Prepare a few thoughtful questions to ask the interviewer."
            ]
        },
        {
            day: 5,
            focus: "Final polish",
            tasks: [
                "Review your resume and align examples with the role requirements.",
                "Check salary expectations, notice period, and logistics.",
                "Get rest, avoid cramming, and rehearse the key stories once more."
            ]
        }
    ]
}

function buildFallbackInterviewReport({ resume = "", selfDescription = "", jobDescription = "" }) {
    const roleKeywords = getUniqueKeywords(jobDescription, 8)
    const profileKeywords = getUniqueKeywords(`${resume} ${selfDescription}`, 12)
    const overlap = roleKeywords.filter(keyword => profileKeywords.some(profileKeyword => profileKeyword.includes(keyword) || keyword.includes(profileKeyword)))

    const matchScore = Math.max(35, Math.min(92, 45 + overlap.length * 8 + Math.min(profileKeywords.length, 5)))

    return {
        title: inferTitle(jobDescription),
        matchScore,
        technicalQuestions: buildTechnicalQuestions(roleKeywords),
        behavioralQuestions: buildBehavioralQuestions(),
        skillGaps: buildSkillGaps(roleKeywords),
        preparationPlan: buildPreparationPlan(roleKeywords)
    }
}

function validateInterviewReport(data) {
    const parsed = interviewReportSchema.safeParse(data)

    if (!parsed.success) {
        throw new Error(`Invalid AI response: ${parsed.error.message}`)
    }

    return parsed.data
}

function parseJsonResponse(responseText) {
    if (!responseText) {
        throw new Error("AI response was empty")
    }

    return JSON.parse(responseText)
}

async function generateInterviewReport({ resume, selfDescription, jobDescription }) {
    if (!ai) {
        return buildFallbackInterviewReport({ resume, selfDescription, jobDescription })
    }

    const prompt = `Generate an interview report for a candidate with the following details:
Resume: ${resume}
Self Description: ${selfDescription}
Job Description: ${jobDescription}

Return only valid JSON that matches the requested schema.`

    let lastError = null

    for (const model of MODEL_CANDIDATES) {
        try {
            const response = await ai.models.generateContent({
                model,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: zodToJsonSchema(interviewReportSchema)
                }
            })

            return validateInterviewReport(parseJsonResponse(response.text))
        }
        catch (error) {
            lastError = error
        }
    }

    console.error("Falling back to local interview report generation:", lastError?.message || lastError)
    return buildFallbackInterviewReport({ resume, selfDescription, jobDescription })


}



async function generateResumeHtmlFromAi({ resume, selfDescription, jobDescription }) {
    const resumePdfSchema = z.object({
        html: z.string().describe("The HTML content of the resume which can be converted to PDF using any library like puppeteer")
    })

    const prompt = `Generate resume for a candidate with the following details:
                        Resume: ${resume}
                        Self Description: ${selfDescription}
                        Job Description: ${jobDescription}

                        the response should be a JSON object with a single field "html" which contains the HTML content of the resume which can be converted to PDF using any library like puppeteer.
                        The resume should be tailored for the given job description and should highlight the candidate's strengths and relevant experience. The HTML content should be well-formatted and structured, making it easy to read and visually appealing.
                        The content of resume should be not sound like it's generated by AI and should be as close as possible to a real human-written resume.
                        you can highlight the content using some colors or different font styles but the overall design should be simple and professional.
                        The content should be ATS friendly, i.e. it should be easily parsable by ATS systems without losing important information.
                        The resume should not be so lengthy, it should ideally be 1-2 pages long when converted to PDF. Focus on quality rather than quantity and make sure to include all the relevant information that can increase the candidate's chances of getting an interview call for the given job description.
                    `

    let lastError = null

    for (const model of MODEL_CANDIDATES) {
        try {
            const response = await ai.models.generateContent({
                model,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: zodToJsonSchema(resumePdfSchema),
                }
            })

            const jsonContent = JSON.parse(response.text)

            if (!jsonContent?.html) {
                throw new Error("AI resume response did not include HTML content")
            }

            return jsonContent.html
        }
        catch (error) {
            lastError = error
        }
    }

    throw lastError || new Error("Unable to generate resume HTML from AI")
}

async function generateResumePdf({ resume, selfDescription, jobDescription, title, matchScore }) {
    let htmlContent = buildFallbackResumeHtml({ title, resume, jobDescription, selfDescription, matchScore })

    if (ai) {
        try {
            htmlContent = await generateResumeHtmlFromAi({ resume, selfDescription, jobDescription })
        }
        catch (error) {
            console.error("Falling back to local resume HTML generation:", error?.message || error)
        }
    }

    return generatePdfFromHtml(htmlContent)
}

module.exports = { generateInterviewReport, generateResumePdf }