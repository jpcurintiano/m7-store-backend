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
const PRECO = 29.9;

app.use(helmet());
app.use(express.json());

app.use(
  cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "M7 Store API online",
  });
});

app.post("/create-payment", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({
        error: "E-mail inválido.",
      });
    }

    if (!process.env.MP_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "MP_ACCESS_TOKEN não configurado no Render.",
      });
    }

    const idempotencyKey = crypto.randomUUID();

    const paymentResponse = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      {
        transaction_amount: PRECO,
        description: "Pacote Streaming - M7 Store",
        payment_method_id: "pix",
        payer: {
          email,
          first_name: "Cliente",
          last_name: "M7 Store",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN.trim()}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        timeout: 20000,
      }
    );

    const data = paymentResponse.data;
    const transactionData = data?.point_of_interaction?.transaction_data;

    console.log("Pagamento criado:", {
      id: data.id,
      status: data.status,
      hasQrCode: Boolean(transactionData?.qr_code),
      hasQrBase64: Boolean(transactionData?.qr_code_base64),
    });

    if (!transactionData?.qr_code || !transactionData?.qr_code_base64) {
      return res.status(500).json({
        error: "Mercado Pago não retornou QR Code Pix.",
        mercado_pago_status: data.status,
        payment_id: data.id,
      });
    }

    return res.status(200).json({
      payment_id: data.id,
      status: data.status,
      qr_code: transactionData.qr_code,
      qr_base64: transactionData.qr_code_base64,
    });
  } catch (err) {
    console.log("Erro ao criar pagamento:", err.response?.data || err.message);

    return res.status(500).json({
      error: "Erro ao criar pagamento Pix.",
      details: err.response?.data || err.message,
    });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    const paymentId =
      body?.data?.id ||
      body?.id ||
      body?.resource?.split("/")?.pop();

    if (!paymentId) {
      return res.sendStatus(200);
    }

    const paymentResponse = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN.trim()}`,
        },
        timeout: 20000,
      }
    );

    const payment = paymentResponse.data;

    console.log("Webhook recebido:", {
      id: payment.id,
      status: payment.status,
      email: payment.payer?.email,
    });

    if (payment.status !== "approved") {
      return res.sendStatus(200);
    }

    const emailCliente = payment.payer?.email;

    if (!emailCliente) {
      console.log("Pagamento aprovado, mas sem e-mail do cliente.");
      return res.sendStatus(200);
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.log("EMAIL_USER ou EMAIL_PASS não configurado.");
      return res.sendStatus(200);
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER.trim(),
        pass: process.env.EMAIL_PASS.trim(),
      },
    });

    await transporter.sendMail({
      from: `"M7 Store" <${process.env.EMAIL_USER.trim()}>`,
      to: emailCliente,
      subject: "Seu acesso - M7 Store",
      text: `
Obrigado pela sua compra!

Aqui estão seus dados de acesso:

Login: COLOQUE_AQUI_O_LOGIN_REAL
Senha: COLOQUE_AQUI_A_SENHA_REAL

Equipe M7 Store
      `,
    });

    console.log("Produto enviado para:", emailCliente);

    return res.sendStatus(200);
  } catch (err) {
    console.log("Erro no webhook:", err.response?.data || err.message);
    return res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
