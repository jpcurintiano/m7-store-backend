require("dotenv").config();
const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const cors = require("cors");

const app = express();

// 🔐 CORS
app.use(cors({
  origin: "https://m7-store.vercel.app",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());
app.use(helmet());

const preco = 29.9;

// ✅ TESTE
app.get("/", (req, res) => {
  res.send("M7 Store API online");
});

// 💰 CRIAR PAGAMENTO PIX
app.post("/create-payment", async (req, res) => {
  const { email } = req.body;

  try {
    const response = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      {
        transaction_amount: preco,
        description: "M7 Store Streaming",
        payment_method_id: "pix",
        payer: { email }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          "X-Idempotency-Key": Date.now().toString()
        }
      }
    );

    const data = response.data;
    const pixData = data.point_of_interaction?.transaction_data;

    res.json({
      qr_code: pixData?.qr_code || null,
      qr_base64: pixData?.qr_code_base64 || null,
      id: data.id
    });

  } catch (err) {
    console.log("ERRO MP:", err.response?.data || err.message);

    res.status(500).json({
      error: err.response?.data || err.message
    });
  }
});

// 🔁 WEBHOOK
app.post("/webhook", async (req, res) => {
  try {
    if (req.body.type === "payment") {
      const id = req.body.data.id;

      const pagamento = await axios.get(
        `https://api.mercadopago.com/v1/payments/${id}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
          }
        }
      );

      if (pagamento.data.status === "approved") {
        const emailCliente = pagamento.data.payer.email;

        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          }
        });

        await transporter.sendMail({
          from: `"M7 Store" <${process.env.EMAIL_USER}>`,
          to: emailCliente,
          subject: "Seu acesso - M7 Store",
          text: `
Obrigado pela sua compra!

Login: seu@email.com
Senha: 123456

Equipe M7 Store
          `
        });

        console.log("✅ Enviado para:", emailCliente);
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.log("ERRO WEBHOOK:", err.message);
    res.sendStatus(500);
  }
});

// 🚀 START
app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
