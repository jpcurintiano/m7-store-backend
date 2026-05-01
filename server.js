require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 3000;

// 🔥 LINK DE PAGAMENTO
const PAYMENT_URL = "https://mpago.la/2Lu7nSJ";

app.use(helmet());
app.use(express.json());

app.use(
  cors({
    origin: "*", // depois pode limitar pro seu site
  })
);

// rota de teste
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "M7 Store API funcionando",
  });
});

// 🔥 rota de compra
app.post("/comprar", (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.status(400).json({
      error: "E-mail inválido",
    });
  }

  console.log("Novo pedido:", email);

  return res.json({
    redirect: PAYMENT_URL,
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
