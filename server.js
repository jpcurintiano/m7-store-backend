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
const PRODUTO = process.env.PRODUTO || "Produto Digital";

app.use(helmet());
app.use(express.json());

app.use(
  cors({
    origin: FRONTEND_URL || "*"
  })
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10
});

function validarCPF(cpf) {
  cpf = cpf.replace(/\D/g, "");

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

app.get("/", (req, res) => {
  res.json({ status: "online" });
});

app.post("/create-payment", limiter, async (req, res) => {
  try {
    const { email, cpf } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Email inválido" });
    }

    if (!validarCPF(cpf)) {
      return res.status(400).json({ error: "CPF inválido" });
    }

    const orderId = crypto.randomUUID();

    const payload = {
      transaction_amount: PRECO,
      description: PRODUTO,
      payment_method_id: "pix",
      payer: {
        email,
        identification: {
          type: "CPF",
          number: cpf.replace(/\D/g, "")
        }
      },
      external_reference: orderId,
      notification_url: WEBHOOK_URL
    };

    const response = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      payload,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`
        }
      }
    );

    const data = response.data;

    res.json({
      payment_id: data.id,
      qr_code: data.point_of_interaction.transaction_data.qr_code,
      qr_base64: data.point_of_interaction.transaction_data.qr_code_base64
    });

  } catch (err) {
    console.log(err.response?.data || err.message);
    res.status(500).json({ error: "Erro ao criar pagamento" });
  }
});

app.get("/payment-status/:id", async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.mercadopago.com/v1/payments/${req.params.id}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`
        }
      }
    );

    res.json({ status: response.data.status });

  } catch (err) {
    res.status(500).json({ error: "Erro ao verificar pagamento" });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;

    if (!paymentId) return res.sendStatus(200);

    const response = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`
        }
      }
    );

    const payment = response.data;

    if (payment.status === "approved") {
      console.log("PAGAMENTO APROVADO:", payment.id);
    }

    res.sendStatus(200);

  } catch {
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log("Servidor rodando na porta", PORT);
});
