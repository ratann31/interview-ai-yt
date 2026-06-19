import { getAllInterviewReports, generateInterviewReport, getInterviewReportById, generateResumePdf } from "../services/interview.api"
import { useContext, useEffect } from "react"
import { InterviewContext } from "../interview.context"
import { useParams } from "react-router"


export const useInterview = () => {

    const context = useContext(InterviewContext)
    const { interviewId } = useParams()

    if (!context) {
        throw new Error("useInterview must be used within an InterviewProvider")
    }

    const { loading, setLoading, report, setReport, reports, setReports } = context

    const generateReport = async ({ jobDescription, selfDescription, resumeFile }) => {
        setLoading(true)
        try {
            const response = await generateInterviewReport({ jobDescription, selfDescription, resumeFile })
            setReport(response.interviewReport)
            return response.interviewReport
        } catch (error) {
            console.log(error)
            throw error
        } finally {
            setLoading(false)
        }
    }

    const getReportById = async (interviewId) => {
        setLoading(true)
        try {
            const response = await getInterviewReportById(interviewId)
            setReport(response.interviewReport)
        } catch (error) {
            console.log(error)
        } finally {
            setLoading(false)
        }
        return null
    }

    const getReports = async () => {
        setLoading(true)
        try {
            const response = await getAllInterviewReports()
            setReports(response.interviewReports)
        } catch (error) {
            console.log(error)
        } finally {
            setLoading(false)
        }

        return []
    }

    const getResumePdf = async (interviewReportId) => {
        setLoading(true)
        try {
            const response = await generateResumePdf({ interviewReportId })

            if (!(response instanceof Blob) || response.type === "application/json") {
                throw new Error("The server returned an invalid PDF response.")
            }

            const url = window.URL.createObjectURL(response)
            const link = document.createElement("a")
            link.href = url
            link.setAttribute("download", `resume_${interviewReportId}.pdf`)
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.URL.revokeObjectURL(url)
        }
        catch (error) {
            let message = "Unable to download the resume PDF."

            const data = error.response?.data
            if (data instanceof Blob) {
                try {
                    const parsed = JSON.parse(await data.text())
                    message = parsed.message || message
                } catch { }
            } else if (data?.message) {
                message = data.message
            } else if (error.message) {
                message = error.message
            }

            console.error(message, error)
            alert(message)
        } finally {
            setLoading(false)
        }
    }

    const currentReportId = report?._id ?? null

    useEffect(() => {
        if (interviewId && currentReportId !== interviewId) {
            getReportById(interviewId)
        } else {
            getReports()
        }
    }, [ interviewId, currentReportId ])

    return { loading, report, reports, generateReport, getReportById, getReports, getResumePdf }

}