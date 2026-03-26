// Intentionally vulnerable Express app for testing vibe-check

const express = require("express");
const jwt = require("jsonwebtoken");
const mysql = require("mysql");
const fs = require("fs");

const app = express();
app.use(express.json());

// BAD: hardcoded API key
const OPENAI_KEY = "sk-abcdefghijklmnopqrstuvwx1234567890ABCDE";

// BAD: hardcoded JWT secret
const JWT_SECRET = "secret";

// BAD: SQL string concat
app.get("/user", (req, res) => {
  const userId = req.query.id;
  const query = "SELECT * FROM users WHERE id = " + userId;
  console.log("Running query:", query);
  res.json({ ok: true });
});

// BAD: innerHTML assignment
function renderUserContent(content) {
  document.getElementById("output").innerHTML = content;
}

// BAD: jwt.sign with no expiry
app.post("/login", (req, res) => {
  const token = jwt.sign({ userId: 1 }, JWT_SECRET);
  res.cookie("token", token, { httpOnly: false, secure: false });
  console.log("token", token);
  res.json({ token });
});

// BAD: JWT stored in localStorage
function storeToken(token) {
  localStorage.setItem("token", token);
}

// BAD: eval with user input
app.post("/eval", (req, res) => {
  const result = eval(req.body.code);
  res.json({ result });
});

// BAD: fs.readFile with user input
app.get("/file", (req, res) => {
  const content = fs.readFileSync(req.query.path);
  res.send(content);
});

// BAD: res.send with err.stack
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.stack });
});

// BAD: User not found enumeration
app.post("/forgot-password", (req, res) => {
  if (!user) res.json({ message: "User not found" });
});

// BAD: CORS wildcard
const cors = require("cors");
app.use(cors({ origin: "*", credentials: true }));

// BAD: Math.random for token
const resetToken = Math.random().toString(36).slice(2);

app.listen(3000);
