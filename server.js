import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import html_to_pdf from "html-pdf-node";
import session from "express-session";
import bcrypt from "bcrypt";
import db from "./db.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "2mb" }));

app.use(session({
  secret: process.env.SESSION_SECRET || "cintra_super_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "You must be logged in." });
  }

  next();
}

app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required." });
    }

    const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(email);

    if (existingUser) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const currentMonth = new Date().getMonth();

    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, plan, monthly_usage, usage_month)
      VALUES (?, ?, ?, 'free', 0, ?)
    `).run(name, email, passwordHash, currentMonth);

    req.session.user = {
      id: result.lastInsertRowid,
      name,
      email,
      plan: "free"
    };

    return res.status(201).json({
      message: "Account created successfully.",
      user: req.session.user
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error creating account." });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      plan: user.plan
    };

    return res.json({
      message: "Login successful.",
      user: req.session.user
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error logging in." });
  }
});

app.get("/auth/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  const user = db.prepare(`
    SELECT id, name, email, plan, monthly_usage, usage_month
    FROM users
    WHERE id = ?
  `).get(req.session.user.id);

  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  const currentMonth = new Date().getMonth();

  if (user.usage_month !== currentMonth) {
    db.prepare(`
      UPDATE users
      SET monthly_usage = 0, usage_month = ?
      WHERE id = ?
    `).run(currentMonth, user.id);

    user.monthly_usage = 0;
    user.usage_month = currentMonth;
  }

  return res.json({ user });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out successfully." });
  });
});

app.post("/api/change-plan", requireAuth, (req, res) => {
  try {
    const { plan } = req.body;

    if (!plan || !["free", "pro", "premium"].includes(plan)) {
      return res.status(400).json({ error: "Invalid plan." });
    }

    db.prepare(`
      UPDATE users
      SET plan = ?
      WHERE id = ?
    `).run(plan, req.session.user.id);

    req.session.user.plan = plan;

    return res.json({
      message: "Plan updated successfully.",
      plan
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error updating plan." });
  }
});

app.post("/api/optimize-resume", requireAuth, async (req, res) => {
  try {
    const { resume, jobDescription } = req.body;

    if (!resume || !jobDescription) {
      return res.status(400).json({ error: "Resume and job description are required." });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.user.id);

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const currentMonth = new Date().getMonth();

    if (user.usage_month !== currentMonth) {
      db.prepare(`
        UPDATE users
        SET monthly_usage = 0, usage_month = ?
        WHERE id = ?
      `).run(currentMonth, user.id);

      user.monthly_usage = 0;
    }

    if (user.plan === "free" && user.monthly_usage >= 2) {
      return res.status(403).json({
        error: "Free plan limit reached. Upgrade to Pro."
      });
    }

    const prompt = `
You are an expert ATS resume evaluator and resume writer.

Analyze the candidate's resume against the job description.

Your job is to:
1. Give an ATS score from 0 to 100
2. List 3 strengths
3. List 3 weaknesses
4. Rewrite and improve the resume for ATS optimization

Rules:
- Keep information truthful
- Improve wording
- Add relevant keywords
- Do not invent fake experience
- Return valid JSON only
- Do not include markdown
- Do not include explanations outside JSON

Return JSON in this exact structure:

{
  "score": 0,
  "strengths": ["", "", ""],
  "weaknesses": ["", "", ""],
  "optimizedResume": ""
}

Resume:
${resume}

Job Description:
${jobDescription}
`;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: "You are a professional ATS resume evaluator and resume optimization assistant."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const aiRaw = response.choices[0].message.content;
    const aiData = JSON.parse(aiRaw);

    db.prepare(`
      UPDATE users
      SET monthly_usage = monthly_usage + 1
      WHERE id = ?
    `).run(user.id);

    return res.json({
      score: aiData.score,
      strengths: aiData.strengths,
      weaknesses: aiData.weaknesses,
      optimizedResume: aiData.optimizedResume
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/download-pdf", async (req, res) => {
  try {
    const { content } = req.body;

    const file = {
      content: `<pre>${content}</pre >`
      };

    const options = {
      format: "A4"
    };

    const pdfBuffer = await html_to_pdf.generatePdf(file, options);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=resume.pdf");

    return res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error generating PDF." });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});