require("dotenv").config();

const express = require("express");
const axios = require("axios");
const helmet = require("helmet");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const PRECO = Number(process.env.PRECO || 29.9);
const PRODUTO = process.env.PRODUTO || "Pacote de Streaming";

if (!MP_ACCESS_TOKEN) {
  console.error("ERRO: MP_ACCESS_TOKEN não configurado no .env");
  process.exit(1);
}

app.use(helmet());
app.use(express.json({ limit: "10kb" }));

app.use(
  cors({
    origin: FRONTEND_URL ? [FRONTEND_URL] : "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    error: "Muitas tentativas. Tente novamente em alguns minutos.",
  },
});

function validarCPF(cpf) {
  if (!cpf) return false;

  cpf = String(cpf).replace(/\D/g, "");

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

function limparCPF(cpf) {
  return String(cpf || "").replace(/\D/g, "");
}

function validarEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "M7 Store API",
  });
});

app.post("/create-payment", limiter, async (req, res) => {
  try {
    const { email, cpf } = req.body;

    if (!validarEmail(email)) {
      return res.status(400).json({
        error: "E-mail inválido.",
      });
    }

    if (!validarCPF(cpf)) {
      return res.status(400).json({
        error: "CPF inválido.",
      });
    }

    const cpfLimpo = limparCPF(cpf);
    const orderId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const payload = {
      transaction_amount: PRECO,
      description: PRODUTO,
      payment_method_id: "pix",
      payer: {
        email: email.trim().toLowerCase(),
        identification: {
          type: "CPF",
          number: cpfLimpo,
        },
      },
      external_reference: orderId,
    };

    if (WEBHOOK_URL) {
      payload.notification_url = WEBHOOK_URL;
    }

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
    const transactionData = data?.point_of_interaction?.transaction_data;

    if (!transactionData?.qr_code || !transactionData?.qr_code_base64) {
      return res.status(500).json({
        error: "Pagamento criado, mas QR Code não foi retornado.",
        payment_id: data.id,
      });
    }

    return res.json({
      success: true,
      payment_id: data.id,
      status: data.status,
      order_id: orderId,
      qr_code: transactionData.qr_code,
      qr_base64: transactionData.qr_code_base64,
    });
  } catch (err) {
    const mpError = err.response?.data;

    console.error("Erro ao criar pagamento:", mpError || err.message);

    return res.status(err.response?.status || 500).json({
      error: "Erro ao criar pagamento.",
      details: mpError?.message || err.message,
    });
  }
});

app.get("/payment-status/:id", limiter, async (req, res) => {
  try {
    const paymentId = req.params.id;

    if (!paymentId) {
      return res.status(400).json({
        error: "ID do pagamento não informado.",
      });
    }

    const response = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    return res.json({
      payment_id: response.data.id,
      status: response.data.status,
      status_detail: response.data.status_detail,
      external_reference: response.data.external_reference,
    });
  } catch (err) {
    console.error("Erro ao verificar pagamento:", err.response?.data || err.message);

    return res.status(err.response?.status || 500).json({
      error: "Erro ao verificar pagamento.",
    });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const paymentId =
      req.body?.data?.id ||
      req.query?.id ||
      req.query?.["data.id"];

    if (!paymentId) {
      return res.sendStatus(200);
    }

    const response = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const payment = response.data;

    if (payment.status === "approved") {
      console.log("PAGAMENTO APROVADO:", {
        id: payment.id,
        email: payment.payer?.email,
        valor: payment.transaction_amount,
        reference: payment.external_reference,
      });

      // Aqui depois você coloca o envio automático do produto.
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err.response?.data || err.message);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
