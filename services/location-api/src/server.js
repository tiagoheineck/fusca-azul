const express = require("express");
const mongoose = require("mongoose");
const amqplib = require("amqplib");
const swaggerUi = require("swagger-ui-express");

const app = express();
app.use(express.json());

const port = Number(process.env.PORT || 3003);
const mongoUri =
  process.env.MONGO_URI ||
  "mongodb://fusca:fusca123@mongo:27017/fusca_azul?authSource=admin";
const rabbitUrl =
  process.env.RABBITMQ_URL || "amqp://fusca:fusca123@rabbitmq:5672";
const EXCHANGE = "fusca_events";

let rabbitChannel = null;

async function connectRabbit() {
  const conn = await amqplib.connect(rabbitUrl);
  rabbitChannel = await conn.createChannel();
  await rabbitChannel.assertExchange(EXCHANGE, "topic", { durable: true });
  console.log("location-api connected to RabbitMQ");
}

function publishEvent(routingKey, payload) {
  if (!rabbitChannel) return;
  rabbitChannel.publish(
    EXCHANGE,
    routingKey,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true, contentType: "application/json" },
  );
}

const locationSchema = new mongoose.Schema(
  {
    geolocation: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator(value) {
            if (!Array.isArray(value) || value.length !== 2) {
              return false;
            }

            const [longitude, latitude] = value;
            return (
              Number.isFinite(longitude) &&
              Number.isFinite(latitude) &&
              longitude >= -180 &&
              longitude <= 180 &&
              latitude >= -90 &&
              latitude <= 90
            );
          },
          message:
            "coordinates must be [longitude, latitude] with valid ranges",
        },
      },
    },
    locatedBy: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

locationSchema.index({ geolocation: "2dsphere" });

const FuscaLocation = mongoose.model("FuscaLocation", locationSchema);

function parsePayload(body) {
  const geolocation = body?.geolocation || body?.geolocalizacao;
  const locatedBy = body?.locatedBy || body?.usuario;

  return { geolocation, locatedBy };
}

function mapDocument(doc) {
  return {
    id: doc._id,
    geolocation: doc.geolocation,
    locatedBy: doc.locatedBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Fusca Location API",
    version: "1.0.0",
    description: "CRUD de localizacoes de fuscas para uso em mapa OpenStreetMap",
  },
  servers: [{ url: "/" }],
  components: {
    schemas: {
      GeolocationPoint: {
        type: "object",
        required: ["type", "coordinates"],
        properties: {
          type: { type: "string", example: "Point" },
          coordinates: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "number" },
            example: [-48.548, -27.596],
            description: "[longitude, latitude]",
          },
        },
      },
      LocationInput: {
        type: "object",
        required: ["geolocation", "locatedBy"],
        properties: {
          geolocation: { $ref: "#/components/schemas/GeolocationPoint" },
          locatedBy: { type: "string", example: "joao" },
          geolocalizacao: { $ref: "#/components/schemas/GeolocationPoint" },
          usuario: { type: "string", example: "joao" },
        },
      },
      Location: {
        type: "object",
        properties: {
          id: { type: "string", example: "682c9086f98bd6b2a4e52713" },
          geolocation: { $ref: "#/components/schemas/GeolocationPoint" },
          locatedBy: { type: "string", example: "joao" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Status do servico",
        responses: {
          "200": { description: "Servico operacional" },
          "503": { description: "Servico degradado" },
        },
      },
    },
    "/locations": {
      post: {
        tags: ["Locations"],
        summary: "Cria uma localizacao de fusca",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LocationInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Localizacao criada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Location" },
              },
            },
          },
          "400": {
            description: "Erro de validacao",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      get: {
        tags: ["Locations"],
        summary: "Lista localizacoes",
        parameters: [
          {
            in: "query",
            name: "usuario",
            required: false,
            schema: { type: "string" },
            description: "Filtra pelo usuario que localizou",
          },
        ],
        responses: {
          "200": {
            description: "Lista de localizacoes",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Location" },
                },
              },
            },
          },
        },
      },
    },
    "/locations/{id}": {
      get: {
        tags: ["Locations"],
        summary: "Busca localizacao por ID",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Localizacao encontrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Location" },
              },
            },
          },
          "400": {
            description: "ID invalido",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Localizacao nao encontrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      put: {
        tags: ["Locations"],
        summary: "Atualiza localizacao por ID",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LocationInput" },
            },
          },
        },
        responses: {
          "200": {
            description: "Localizacao atualizada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Location" },
              },
            },
          },
          "400": {
            description: "Erro de validacao ou ID invalido",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Localizacao nao encontrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      delete: {
        tags: ["Locations"],
        summary: "Remove localizacao por ID",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "204": { description: "Localizacao removida" },
          "400": {
            description: "ID invalido",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Localizacao nao encontrada",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
};

app.get("/docs.json", (req, res) => {
  res.status(200).json(openapiSpec);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.get("/health", (req, res) => {
  const readyStateText = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  const mongoState = mongoose.connection.readyState;
  const isHealthy = mongoState === 1;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    service: "location-api",
    mongo: readyStateText[mongoState] || "unknown",
    timestamp: new Date().toISOString(),
  });
});

app.post("/locations", async (req, res) => {
  try {
    const payload = parsePayload(req.body);
    const created = await FuscaLocation.create(payload);
    const doc = mapDocument(created);

    publishEvent("fusca.location.created", {
      event: "fusca.location.created",
      timestamp: new Date().toISOString(),
      data: doc,
    });

    res.status(201).json(doc);
  } catch (error) {
    if (error.name === "ValidationError") {
      res.status(400).json({
        error: "validation_error",
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      error: "internal_error",
      message: error.message,
    });
  }
});

app.get("/locations", async (req, res) => {
  try {
    const query = {};
    if (req.query.usuario) {
      query.locatedBy = req.query.usuario;
    }

    const locations = await FuscaLocation.find(query).sort({ createdAt: -1 });
    res.status(200).json(locations.map(mapDocument));
  } catch (error) {
    res.status(500).json({
      error: "internal_error",
      message: error.message,
    });
  }
});

app.get("/locations/:id", async (req, res) => {
  try {
    const location = await FuscaLocation.findById(req.params.id);
    if (!location) {
      res.status(404).json({
        error: "not_found",
        message: "Location not found",
      });
      return;
    }

    res.status(200).json(mapDocument(location));
  } catch (error) {
    if (error.name === "CastError") {
      res.status(400).json({
        error: "invalid_id",
        message: "Invalid location id",
      });
      return;
    }

    res.status(500).json({
      error: "internal_error",
      message: error.message,
    });
  }
});

app.put("/locations/:id", async (req, res) => {
  try {
    const payload = parsePayload(req.body);
    const location = await FuscaLocation.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!location) {
      res.status(404).json({
        error: "not_found",
        message: "Location not found",
      });
      return;
    }

    res.status(200).json(mapDocument(location));
  } catch (error) {
    if (error.name === "CastError") {
      res.status(400).json({
        error: "invalid_id",
        message: "Invalid location id",
      });
      return;
    }

    if (error.name === "ValidationError") {
      res.status(400).json({
        error: "validation_error",
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      error: "internal_error",
      message: error.message,
    });
  }
});

app.delete("/locations/:id", async (req, res) => {
  try {
    const deleted = await FuscaLocation.findByIdAndDelete(req.params.id);
    if (!deleted) {
      res.status(404).json({
        error: "not_found",
        message: "Location not found",
      });
      return;
    }

    res.status(204).send();
  } catch (error) {
    if (error.name === "CastError") {
      res.status(400).json({
        error: "invalid_id",
        message: "Invalid location id",
      });
      return;
    }

    res.status(500).json({
      error: "internal_error",
      message: error.message,
    });
  }
});

async function start() {
  try {
    await mongoose.connect(mongoUri);
    await connectRabbit();
    app.listen(port, () => {
      console.log(`location-api running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start location-api", error);
    process.exit(1);
  }
}

start();
