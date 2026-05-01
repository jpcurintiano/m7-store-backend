require("dotenv").config();
const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const helmet = require("helmet");

const app = express();
app.use(express.json());
app.use(helmet());

const preco = 29.9;

// rota teste
app.get("/", (req, res) => {
  res.send("M7 Store API online");
});

// criar pagamento PIX
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
    console.log(err.response?.data);
    res.status(500).send("erro ao criar pagamento");
  }
});

// webhook (confirma pagamento)
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

        // envio de email
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          }
        });

        await transporter.sendMail({
          from: "M7 Store",
          to: emailCliente,
          subject: "Seu acesso - M7 Store",
          text: `
Login: seu@email.com
Senha: 123456
          `
        });

        console.log("Produto enviado");
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.log(err);
    res.sendStatus(500);
  }
});

app.listen(3000, () => console.log("rodando"));
