import { Pool, QueryResult } from "pg";

function getEnvVar(key: string): string {
  const value = process.env[key];
  if (typeof value !== "string") {
    throw new Error(
      `Environment variable ${key} is not a string or is undefined`
    );
  }
  return value;
}

const user = getEnvVar("DB_USER");
const password = getEnvVar("DB_PASS");
const database = getEnvVar("DB_NAME");
const host = getEnvVar("DB_HOST");
const port = getEnvVar("DB_PORT");
const ssl = getEnvVar("DB_SSL");

const connectionString = `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=${ssl}`;

// Our primary database connection pool
export const pool = new Pool({ connectionString });

// Function to execute a query with parameters
export async function query<T>(text: string, params?: any[]): Promise<T[]> {
  console.log("Executing query:", text);
  if (params) {
    console.log("With parameters:", params);
  }

  try {
    const res: QueryResult = await pool.query(text, params);
    console.log("Query result:", res.rows);
    console.log("Affected rows:", res.rowCount);
    return res.rows as T[];
  } catch (err) {
    console.error("Error executing query:", text, "Error:", err);
    throw err;
  }
}

// Function to execute an insert/update/delete operation
