require("dotenv").config();
const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const cors = require("cors");

const app = express();

// 🔐 CORS (libera seu site da Vercel)
app.use(cors({
  origin: "https://m7-store.vercel.app",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());
app.use(helmet());

const preco = 29.9;

// rota teste
app.get("/", (req, res) => {
  res.send("M7 Store API online");
});

// 🔥 CRIAR PAGAMENTO PIX
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
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      }
    );

    const data = response.data;

    res.json({
      qr_code: data.point_of_interaction.transaction_data.qr_code,
      qr_base64: data.point_of_interaction.transaction_data.qr_code_base64,
      id: data.id
    });

  } catch (err) {
    console.log("Erro ao criar pagamento:", err.response?.data || err.message);
    res.status(500).send("Erro ao gerar pagamento");
  }
});

// 🔁 WEBHOOK (CONFIRMA PAGAMENTO)
app.post("/webhook", async (req, res) => {
  try {
    if (req.body.type === "payment") {
      const id = req.body.data.id;

      // consulta pagamento real
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

        // envio de email
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

Aqui estão seus dados:

Login: seu@email.com
Senha: 123456

Equipe M7 Store
          `
        });

        console.log("✅ Produto enviado para:", emailCliente);
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.log("Erro no webhook:", err.message);
    res.sendStatus(500);
  }
});

// 🚀 START
app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
