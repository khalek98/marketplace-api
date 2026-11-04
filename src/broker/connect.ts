import amqp from "amqplib";
import type { Channel, ChannelModel, ConfirmChannel } from "amqplib";

export function brokerUrlFromEnv(): string {
  const url = process.env.BROKER_URL?.trim();
  if (!url) {
    throw new Error("BROKER_URL is required (amqp://… — AMQP port, not the management UI)");
  }
  return url;
}

export async function connectBroker(url = brokerUrlFromEnv()): Promise<ChannelModel> {
  return amqp.connect(url);
}

export async function withChannel<T>(fn: (ch: Channel) => Promise<T>, url?: string): Promise<T> {
  const conn = await connectBroker(url);
  try {
    const ch = await conn.createChannel();
    try {
      return await fn(ch);
    } finally {
      await ch.close().catch(() => undefined);
    }
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function withConfirmChannel<T>(fn: (ch: ConfirmChannel) => Promise<T>, url?: string): Promise<T> {
  const conn = await connectBroker(url);
  try {
    const ch = await conn.createConfirmChannel();
    try {
      return await fn(ch);
    } finally {
      await ch.close().catch(() => undefined);
    }
  } finally {
    await conn.close().catch(() => undefined);
  }
}
