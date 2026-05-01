require("dotenv").config();
const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const helmet = require("helmet");

const app = express();
app.use(express.json());
app.use(helmet());

// rota teste
app.get("/", (req, res) => {
  res.send("M7 Store API online");
});

app.listen(3000, () => console.log("rodando"));
