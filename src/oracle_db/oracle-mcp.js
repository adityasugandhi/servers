#!/usr/bin/env node

import oracledb from "oracledb";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "example-servers/oracle",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error("Usage: oracle-mcp.js <DB_USER> <DB_PASSWORD> <DB_CONNECT_STRING>");
  process.exit(1);
}

const [DB_USER, DB_PASSWORD, DB_CONNECT_STRING] = args;

async function getOracleConnection() {
  return await oracledb.getConnection({
    user: DB_USER,
    password: DB_PASSWORD,
    connectString: DB_CONNECT_STRING,
  });
}

const SCHEMA_PATH = "schema";

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const connection = await getOracleConnection();
  try {
    const result = await connection.execute(
      `SELECT table_name FROM user_tables`
    );
    return {
      resources: result.rows.map(([table_name]) => ({
        uri: `oracle://${DB_USER}/${table_name}/${SCHEMA_PATH}`,
        mimeType: "application/json",
        name: `"${table_name}" database schema`,
      })),
    };
  } finally {
    await connection.close();
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resourceUrl = new URL(request.params.uri);
  const pathComponents = resourceUrl.pathname.split("/");
  const schema = pathComponents.pop();
  const tableName = pathComponents.pop();

  if (schema !== SCHEMA_PATH) {
    throw new Error("Invalid resource URI");
  }

  const connection = await getOracleConnection();
  try {
    const result = await connection.execute(
      `SELECT column_name, data_type FROM user_tab_columns WHERE table_name = :table`,
      [tableName.toUpperCase()]
    );

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(result.rows, null, 2),
        },
      ],
    };
  } finally {
    await connection.close();
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query",
        description: "Run a read-only SQL query",
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string" },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "query") {
    const sql = request.params.arguments?.sql;

    const connection = await getOracleConnection();
    try {
      await connection.execute("ALTER SESSION SET TRANSACTION READ ONLY");
      const result = await connection.execute(sql);

      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    } finally {
      await connection.close();
    }
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);
