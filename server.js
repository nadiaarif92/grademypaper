import express from 'express';
import multer from 'multer';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function fileToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType
    },
  };
}

// Single-file endpoint with Google Search grounding
app.post('/api/grade', upload.single('studentSolution'), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "Please upload the student solution file." });
    }

    const contents = [
      { 
        text: `You are an expert Chief Examiner and Grader. 
        1. Examine this student's uploaded solution paper. 
        2. Identify the Exam Board, Subject, Subject Code, Year, and Session from the paper.
        3. Use Google Search to find the official Question Paper and Marking Scheme for this exact paper online.
        4. Thoroughly evaluate the student's solution against the official marking scheme you find.` 
      },
      fileToGenerativePart(file.buffer, file.mimetype)
    ];

    // Call Gemini with googleSearch tool enabled so it can look up papers dynamically
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: contents,
      config: {
        tools: [{ googleSearch: {} }], // Enables live internet lookups for marking schemes
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedExamInfo: { type: Type.STRING, description: "Board, Subject, and Code identified from the paper" },
            totalScoreAwarded: { type: Type.NUMBER },
            maxPossibleScore: { type: Type.NUMBER },
            percentage: { type: Type.NUMBER },
            estimatedGrade: { type: Type.STRING },
            generalFeedback: { type: Type.STRING },
            questionBreakdown: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionNumber: { type: Type.STRING },
                  marksAwarded: { type: Type.NUMBER },
                  maxMarks: { type: Type.NUMBER },
                  isCorrect: { type: Type.BOOLEAN },
                  examinerNotes: { type: Type.STRING }
                },
                required: ["questionNumber", "marksAwarded", "maxMarks", "isCorrect", "examinerNotes"]
              }
            }
          },
          required: ["detectedExamInfo", "totalScoreAwarded", "maxPossibleScore", "percentage", "estimatedGrade", "generalFeedback", "questionBreakdown"]
        }
      }
    });

    if (!response || !response.text) {
      throw new Error("Received an empty response from Gemini API.");
    }

    const resultJson = JSON.parse(response.text);
    res.json({ success: true, evaluation: resultJson });

  } catch (error) {
    console.error("Grading error:", error);
    res.status(500).json({ error: error.message || "An error occurred during AI evaluation." });
  }
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
server.timeout = 120000;
server.keepAliveTimeout = 120000;
