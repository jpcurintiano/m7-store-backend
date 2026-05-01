require("dotenv").config();

const express = require("express");
const axios = require("axios");
const helmet = require("helmet");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const app = express();

// 🔥 ESSENCIAL NO RENDER (resolve erro de proxy)
app.set("trust proxy", 1);

// 🔐 ENV
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// 🔗 webhook automático
const WEBHOOK_URL = `${BASE_URL}/webhook`;

const PRECO = Number(process.env.PRECO || 29.9);
const PRODUTO = process.env.PRODUTO || "Pacote de Streaming";

// 🛡️ Segurança
app.use(helmet());
app.use(express.json({ limit: "10kb" }));

app.use(
  cors({
    origin: FRONTEND_URL
      ? [FRONTEND_URL, `${FRONTEND_URL}/`]
      : "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// 🚫 Rate limit global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

app.use(globalLimiter);

// 🚫 Rate limit pagamento
const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: "Muitas tentativas. Aguarde alguns minutos." },
});

// 🧠 antifraude simples
const attempts = new Map();

function checkFraud(ip, email) {
  const key = `${ip}_${email}`;
  const now = Date.now();

  if (!attempts.has(key)) {
    attempts.set(key, { count: 1, time: now });
    return false;
  }

  const data = attempts.get(key);

  if (now - data.time > 10 * 60 * 1000) {
    attempts.set(key, { count: 1, time: now });
    return false;
  }

  data.count++;

  return data.count > 3;
}

// 📧 validar email
function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 🪪 limpar CPF
function limparCPF(cpf) {
  return String(cpf || "").replace(/\D/g, "");
}

// 🪪 validar CPF
function validarCPF(cpf) {
  if (!cpf) return false;

  cpf = limparCPF(cpf);

  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  let soma = 0;

  for (let i = 0; i < 9; i++) {
    soma += Number(cpf[i]) * (10 - i);
  }

  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== Number(cpf[9])) return false;

  soma = 0;

  for (let i = 0; i < 10; i++) {
    soma += Number(cpf[i]) * (11 - i);
  }

  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;

  return resto === Number(cpf[10]);
}

// 🏠 rota base
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "M7 Store API",
  });
});

// 💰 CRIAR PIX
app.post("/create-payment", paymentLimiter, async (req, res) => {
  try {
    const ip = req.ip;
    const { email, cpf } = req.body;

    if (!validarEmail(email)) {
      return res.status(400).json({ error: "E-mail inválido" });
    }

    if (!validarCPF(cpf)) {
      return res.status(400).json({ error: "CPF inválido" });
    }

    if (checkFraud(ip, email)) {
      return res.status(429).json({
        error: "Comportamento suspeito detectado.",
      });
    }

    const orderId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const payload = {
      transaction_amount: PRECO,
      description: PRODUTO,
      payment_method_id: "pix",
      payer: {
        email: email.toLowerCase().trim(),
        identification: {
          type: "CPF",
          number: limparCPF(cpf),
        },
      },
      external_reference: orderId,
      notification_url: WEBHOOK_URL,
    };

    const response = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      payload,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        timeout: 15000,
      }
    );

    const data = response.data;
    const tx = data.point_of_interaction?.transaction_data;

    if (!tx) {
      return res.status(500).json({
        error: "Erro ao gerar QR Code",
      });
    }

    res.json({
      success: true,
      payment_id: data.id,
      status: data.status,
      qr_code: tx.qr_code,
      qr_base64: tx.qr_code_base64,
    });
  } catch (err) {
    console.error("ERRO PAGAMENTO:", err.response?.data || err.message);

    res.status(err.response?.status || 500).json({
      error: "Erro ao criar pagamento",
    });
  }
});

// 🔍 verificar status
app.get("/payment-status/:id", async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.mercadopago.com/v1/payments/${req.params.id}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        },
      }
    );

    res.json({
      status: response.data.status,
    });
  } catch {
    res.status(500).json({ error: "Erro ao verificar pagamento" });
  }
});

// 🔔 webhook
app.post("/webhook", async (req, res) => {
  try {
    const paymentId =
      req.body?.data?.id ||
      req.query?.id ||
      req.query?.["data.id"];

    if (!paymentId) return res.sendStatus(200);

    const response = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        },
      }
    );

    const payment = response.data;

    if (payment.status === "approved") {
      console.log("💰 PAGAMENTO APROVADO:", payment.id);
    }

    res.sendStatus(200);
  } catch {
    res.sendStatus(200);
  }
});

// 🚀 start
app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});
