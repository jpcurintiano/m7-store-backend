require("dotenv").config();

const express = require("express");
const axios = require("axios");
const helmet = require("helmet");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const app = express();

// 🔥 obrigatório no Render
app.set("trust proxy", 1);

// ENV
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// webhook automático
const WEBHOOK_URL = `${BASE_URL}/webhook`;

const PRECO = Number(process.env.PRECO || 29.9);
const PRODUTO = process.env.PRODUTO || "Pacote de Streaming";

// segurança
app.use(helmet());
app.use(express.json({ limit: "10kb" }));

app.use(
  cors({
    origin: FRONTEND_URL
      ? [FRONTEND_URL, `${FRONTEND_URL}/`]
      : "*",
  })
);

// rate limit global
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  })
);

// rate limit pagamento
const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: "Muitas tentativas. Aguarde." },
});

// valida email
function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// rota base
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "M7 Store API",
  });
});

// 💰 CRIAR PIX (SEM CPF)
app.post("/create-payment", paymentLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!validarEmail(email)) {
      return res.status(400).json({ error: "E-mail inválido" });
    }

    const orderId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const payload = {
      transaction_amount: PRECO,
      description: PRODUTO,
      payment_method_id: "pix",
      payer: {
        email: email.toLowerCase().trim(),
        first_name: "Cliente",
        last_name: "M7",
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
    console.log("STATUS:", err.response?.status);
    console.log("DATA:", err.response?.data);
    console.log("MSG:", err.message);

    res.status(err.response?.status || 500).json({
      error: err.response?.data || "Erro ao criar pagamento",
    });
  }
});

// status pagamento
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

// webhook
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

// start
app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});
