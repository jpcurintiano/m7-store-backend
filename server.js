require("dotenv").config();

const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || "https://m7-store.vercel.app";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN?.trim();

const EMAIL_USER = process.env.EMAIL_USER?.trim();
const EMAIL_PASS = process.env.EMAIL_PASS?.trim();

const PRECO = Number(process.env.PRECO || 29.9);
const PRODUTO_NOME = process.env.PRODUTO_NOME || "Produto Digital - M7 Store";

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

function isValidEmail(email) {
  return typeof email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getMercadoPagoError(err) {
  return err.response?.data || {
    message: err.message || "Erro desconhecido",
  };
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "M7 Store API online",
  });
});

app.post("/create-payment", async (req, res) => {
  try {
    const email = req.body?.email?.trim().toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "E-mail inválido.",
      });
    }

    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "MP_ACCESS_TOKEN não configurado.",
      });
    }

    const idempotencyKey = crypto.randomUUID();

    const payload = {
      transaction_amount: PRECO,
      description: PRODUTO_NOME,
      payment_method_id: "pix",

      payer: {
        email,
        first_name: "Cliente",
        last_name: "M7 Store",
      },

      external_reference: email,

      notification_url: process.env.WEBHOOK_URL || undefined,
    };

    const paymentResponse = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      payload,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        timeout: 20000,
      }
    );

    const payment = paymentResponse.data;
    const transactionData = payment?.point_of_interaction?.transaction_data;

    console.log("Pagamento Pix criado:", {
      id: payment.id,
      status: payment.status,
      email,
      hasQrCode: Boolean(transactionData?.qr_code),
      hasQrBase64: Boolean(transactionData?.qr_code_base64),
    });

    if (!transactionData?.qr_code || !transactionData?.qr_code_base64) {
      return res.status(500).json({
        error: "Mercado Pago não retornou QR Code Pix.",
        payment_id: payment.id,
        status: payment.status,
      });
    }

    return res.status(200).json({
      payment_id: payment.id,
      status: payment.status,
      qr_code: transactionData.qr_code,
      qr_base64: transactionData.qr_code_base64,
      ticket_url: transactionData.ticket_url,
    });
  } catch (err) {
    const details = getMercadoPagoError(err);

    console.log("Erro ao criar pagamento:", details);

    return res.status(500).json({
      error: "Erro ao criar pagamento Pix.",
      details,
    });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      console.log("MP_ACCESS_TOKEN não configurado no webhook.");
      return res.sendStatus(200);
    }

    const body = req.body;

    const paymentId =
      body?.data?.id ||
      body?.id ||
      body?.resource?.split("/")?.pop();

    if (!paymentId) {
      console.log("Webhook recebido sem paymentId:", body);
      return res.sendStatus(200);
    }

    const paymentResponse = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        },
        timeout: 20000,
      }
    );

    const payment = paymentResponse.data;

    console.log("Webhook Mercado Pago:", {
      id: payment.id,
      status: payment.status,
      external_reference: payment.external_reference,
      payer_email: payment.payer?.email,
    });

    if (payment.status !== "approved") {
      return res.sendStatus(200);
    }

    const emailCliente = payment.external_reference;

    if (!isValidEmail(emailCliente)) {
      console.log("Pagamento aprovado, mas e-mail do cliente inválido.");
      return res.sendStatus(200);
    }

    if (!EMAIL_USER || !EMAIL_PASS) {
      console.log("EMAIL_USER ou EMAIL_PASS não configurado.");
      return res.sendStatus(200);
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"M7 Store" <${EMAIL_USER}>`,
      to: emailCliente,
      subject: "Seu acesso - M7 Store",
      text: `
Olá! Obrigado pela sua compra.

Seu pagamento foi aprovado com sucesso.

Aqui estão as informações do seu produto:

Login: COLOQUE_AQUI_O_LOGIN_REAL
Senha: COLOQUE_AQUI_A_SENHA_REAL

Qualquer dúvida, entre em contato com o suporte.

Equipe M7 Store
      `.trim(),
    });

    console.log("Produto enviado para:", emailCliente);

    return res.sendStatus(200);
  } catch (err) {
    console.log("Erro no webhook:", getMercadoPagoError(err));
    return res.sendStatus(200);
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Rota não encontrada.",
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
