import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { readJson, writeJson } from "./json-db";

const FILE_NAME = "users.json";

export function listUsers() {
  return readJson(FILE_NAME, []);
}

export function findUserByEmail(email) {
  return listUsers().find((user) => user.email.toLowerCase() === email.toLowerCase());
}

export async function createUser({ name, email, password }) {
  const users = listUsers();
  const existing = users.find((user) => user.email.toLowerCase() === email.toLowerCase());

  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    name,
    email: email.toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  writeJson(FILE_NAME, [user, ...users]);
  return user;
}

export async function verifyUser(email, password) {
  const user = findUserByEmail(email);
  if (!user) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

