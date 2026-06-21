const express = require("express");
const amqplib = require("amqplib");

const app = express();
const port = Number(process.env.PORT || 3004);
const rabbitUrl =
  process.env.RABBITMQ_URL || "amqp://fusca:fusca123@rabbitmq:5672";
const EXCHANGE = "fusca_events";
const QUEUE = "notification.fusca.location.created";
const ROUTING_KEY = "fusca.location.created";

// Mantém histórico simples em memória para fins de demo
const notifications = [];

async function startConsumer() {
  const conn = await amqplib.connect(rabbitUrl);
  const channel = await conn.createChannel();

  // Garante que o exchange existe (idempotente)
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });

  // Fila durável, sobrevive a restart do broker
  await channel.assertQueue(QUEUE, { durable: true });

  // Bind: esta fila recebe mensagens com routing key "fusca.location.created"
  await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);

  // Processa uma mensagem por vez (prefetch = 1)
  channel.prefetch(1);

  console.log(
    `[notification-api] Aguardando eventos "${ROUTING_KEY}" em "${QUEUE}"…`,
  );

  channel.consume(QUEUE, (msg) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString());

      const notification = {
        receivedAt: new Date().toISOString(),
        event: event.event,
        locationId: event.data?.id,
        locatedBy: event.data?.locatedBy,
        coordinates: event.data?.geolocation?.coordinates,
      };

      notifications.unshift(notification); // mais recente primeiro
      if (notifications.length > 100) notifications.pop(); // limite de memória

      console.log(
        `[notification-api] Nova localização registrada por "${notification.locatedBy}" em ${notification.coordinates}`,
      );

      // Confirma processamento bem-sucedido (ack)
      channel.ack(msg);
    } catch (err) {
      console.error("[notification-api] Erro ao processar mensagem:", err);
      // Descarta a mensagem sem requeue para evitar loop infinito
      channel.nack(msg, false, false);
    }
  });
}

// Endpoint de saúde
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "notification-api",
    timestamp: new Date().toISOString(),
  });
});

// Endpoint para inspecionar notificações recebidas (útil para demos/testes)
app.get("/notifications", (req, res) => {
  res.status(200).json(notifications);
});

async function start() {
  try {
    await startConsumer();
    app.listen(port, () => {
      console.log(`notification-api running on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to start notification-api:", err);
    process.exit(1);
  }
}

start();
