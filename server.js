require("dotenv").config();

const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL?.trim();
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN?.trim();
const WEBHOOK_URL = process.env.WEBHOOK_URL?.trim();

const EMAIL_USER = process.env.EMAIL_USER?.trim();
const EMAIL_PASS = process.env.EMAIL_PASS?.trim();

const PRECO = Number(process.env.PRECO || 29.9);
const PRODUTO_NOME = process.env.PRODUTO_NOME || "Produto Digital - M7 Store";
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || "suporte da M7 Store";

const DELIVERY_CONTENT =
  process.env.DELIVERY_CONTENT ||
  "Seu produto digital será enviado pela equipe M7 Store.";

const processedPayments = new Set();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: FRONTEND_URL || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Muitas tentativas. Aguarde alguns minutos e tente novamente."
  }
});

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= 120 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function safeString(value, max = 120) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function getMercadoPagoError(err) {
  return err.response?.data || {
    message: err.message || "Erro desconhecido"
  };
}

function createEmailTransporter() {
  if (!EMAIL_USER || !EMAIL_PASS) return null;

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });
}

async function sendProductEmail(emailCliente, paymentId) {
  const transporter = createEmailTransporter();

  if (!transporter) {
    throw new Error("E-mail não configurado.");
  }

  await transporter.sendMail({
    from: `"M7 Store" <${EMAIL_USER}>`,
    to: emailCliente,
    subject: "Compra aprovada - M7 Store",
    text: `
Olá! Obrigado pela sua compra.

Seu pagamento foi aprovado com sucesso.

Produto: ${PRODUTO_NOME}
Pagamento: ${paymentId}

Entrega:
${DELIVERY_CONTENT}

Caso tenha qualquer problema, entre em contato com ${SUPPORT_CONTACT}.

Equipe M7 Store
    `.trim()
  });
}

app.get("/", (req, res) => {
  res.status(200).json({
    status: "online",
    message: "M7 Store API online"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime()
  });
});

app.post("/create-payment", paymentLimiter, async (req, res) => {
  try {
    const email = safeString(req.body?.email, 120).toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "E-mail inválido."
      });
    }

    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "MP_ACCESS_TOKEN não configurado."
      });
    }

    if (!PRECO || PRECO <= 0) {
      return res.status(500).json({
        error: "PRECO inválido."
      });
    }

    const orderId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const payload = {
      transaction_amount: PRECO,
      description: PRODUTO_NOME,
      payment_method_id: "pix",
      payer: {
        email
      },
      external_reference: orderId,
      metadata: {
        order_id: orderId,
        customer_email: email,
        product_name: PRODUTO_NOME
      }
    };

    if (WEBHOOK_URL) {
      payload.notification_url = WEBHOOK_URL;
    }

    const paymentResponse = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      payload,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey
        },
        timeout: 20000
      }
    );

    const payment = paymentResponse.data;
    const transactionData = payment?.point_of_interaction?.transaction_data;

    if (!transactionData?.qr_code || !transactionData?.qr_code_base64) {
      return res.status(500).json({
        error: "Mercado Pago não retornou QR Code Pix.",
        payment_id: payment.id,
        status: payment.status
      });
    }

    return res.status(201).json({
      payment_id: payment.id,
      status: payment.status,
      order_id: orderId,
      qr_code: transactionData.qr_code,
      qr_base64: transactionData.qr_code_base64,
      ticket_url: transactionData.ticket_url
    });
  } catch (err) {
    const details = getMercadoPagoError(err);

    console.log("Erro ao criar pagamento:", details);

    return res.status(500).json({
      error: "Erro ao criar pagamento.",
      details: details?.message || details?.error || "Erro desconhecido"
    });
  }
});

app.get("/payment-status/:paymentId", async (req, res) => {
  try {
    const paymentId = safeString(req.params.paymentId, 80);

    if (!paymentId) {
      return res.status(400).json({
        error: "paymentId inválido."
      });
    }

    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "MP_ACCESS_TOKEN não configurado."
      });
    }

    const paymentResponse = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`
        },
        timeout: 20000
      }
    );

    const payment = paymentResponse.data;

    return res.status(200).json({
      payment_id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail
    });
  } catch (err) {
    const details = getMercadoPagoError(err);

    console.log("Erro ao consultar pagamento:", details);

    return res.status(500).json({
      error: "Erro ao consultar pagamento.",
      details: details?.message || details?.error || "Erro desconhecido"
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
      console.log("Webhook sem paymentId:", body);
      return res.sendStatus(200);
    }

    const paymentResponse = await axios.get(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`
        },
        timeout: 20000
      }
    );

    const payment = paymentResponse.data;

    console.log("Webhook recebido:", {
      payment_id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail
    });

    if (payment.status !== "approved") {
      return res.sendStatus(200);
    }

    if (processedPayments.has(String(payment.id))) {
      console.log("Pagamento já processado:", payment.id);
      return res.sendStatus(200);
    }

    const emailCliente = safeString(
      payment.metadata?.customer_email || payment.payer?.email,
      120
    ).toLowerCase();

    if (!isValidEmail(emailCliente)) {
      console.log("Pagamento aprovado, mas e-mail inválido.");
      return res.sendStatus(200);
    }

    await sendProductEmail(emailCliente, payment.id);

    processedPayments.add(String(payment.id));

    console.log("Produto enviado para:", emailCliente);

    return res.sendStatus(200);
  } catch (err) {
    console.log("Erro no webhook:", getMercadoPagoError(err));
    return res.sendStatus(200);
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Rota não encontrada."
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
