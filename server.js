import express from 'express';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Hostinger provides the port via process.env.PORT, defaults to 3000 locally
const port = process.env.PORT || 3000;

// Initialize Google Gen AI SDK (picks up GEMINI_API_KEY environment variable)
// Explicitly pass the environment variable to the SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Configure multer for temporary file uploads in memory
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend HTML page from the public directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper function to convert buffer to Gemini Part object
function fileToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType
    },
  };
}

// API Endpoint to process grading
app.post('/api/grade', upload.fields([
  { name: 'questionPaper', maxCount: 1 },
  { name: 'markingScheme', maxCount: 1 },
  { name: 'studentSolution', maxCount: 1 }
]), async (req, res) => {
  try {
    const { board, grade, subject } = req.body;
    const files = req.files;

    if (!files || !files.questionPaper || !files.markingScheme || !files.studentSolution) {
      return res.status(400).json({ error: "Please upload all three required files: Question Paper, Marking Scheme, and Student Solution." });
    }

    const qp = files.questionPaper[0];
    const ms = files.markingScheme[0];
    const sol = files.studentSolution[0];

    // Build multimodal inputs for Gemini
    const contents = [
      { text: `You are an expert Chief Examiner and Grader for ${board} examinations. You are assessing a student submission for Grade ${grade}, Subject: ${subject}.` },
      { text: "Here is the Official Question Paper:" },
      fileToGenerativePart(qp.buffer, qp.mimetype),
      { text: "Here is the Official Marking Scheme / Rubric:" },
      fileToGenerativePart(ms.buffer, ms.mimetype),
      { text: "Here is the Student's Solution/Attempt:" },
      fileToGenerativePart(sol.buffer, sol.mimetype),
      { 
        text: `Please thoroughly evaluate the student's solution against the question paper and marking scheme. 
        Provide a detailed breakdown question-by-question, awards marks accurately following the marking scheme rules (including method marks 'M', accuracy marks 'A', and independent marks 'B' if applicable), point out errors, and provide constructive feedback for improvement.` 
      }
    ];

    // Call Gemini using Structured JSON Schema output for precise parsing
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            totalScoreAwarded: { type: Type.NUMBER, description: "Total marks earned by the student" },
            maxPossibleScore: { type: Type.NUMBER, description: "Total maximum marks possible for the paper" },
            percentage: { type: Type.NUMBER, description: "Calculated percentage score" },
            estimatedGrade: { type: Type.STRING, description: "Estimated grade based on standard boundaries" },
            generalFeedback: { type: Type.STRING, description: "Overall summary feedback on student performance" },
            questionBreakdown: {
              type: Type.ARRAY,
              description: "Detailed step-by-step marking breakdown per question or sub-question",
              items: {
                type: Type.OBJECT,
                properties: {
                  questionNumber: { type: Type.STRING, description: "e.g., 1a, 2(b)(i)" },
                  marksAwarded: { type: Type.NUMBER },
                  maxMarks: { type: Type.NUMBER },
                  isCorrect: { type: Type.BOOLEAN },
                  examinerNotes: { type: Type.STRING, description: "Specific reasoning for marks given or deducted based on marking scheme" }
                },
                required: ["questionNumber", "marksAwarded", "maxMarks", "isCorrect", "examinerNotes"]
              }
            }
          },
          required: ["totalScoreAwarded", "maxPossibleScore", "percentage", "estimatedGrade", "generalFeedback", "questionBreakdown"]
        }
      }
    });

    const resultJson = JSON.parse(response.text);
    res.json({ success: true, evaluation: resultJson });

  } catch (error) {
    console.error("Grading error:", error);
    res.status(500).json({ error: error.message || "An error occurred during AI evaluation." });
  }
});

// CRITICAL: Bind to '0.0.0.0' so Hostinger's proxy routing can access the application container
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
