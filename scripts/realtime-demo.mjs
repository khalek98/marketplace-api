import { io } from "socket.io-client";

// Fresh seed: sellers are 1–2, buyer1 is 3, buyer2 is 4, the first product is 1.
// GET /products is still the in-memory catalog; checkout debits the SQL product.
const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const buyerA = "3";
const buyerB = "4";
const productId = "1";
const sameRoom = process.argv.includes("--same-room");

let socketA;
let socketB;
let receivedA = 0;
let receivedB = 0;

let orderA;
let orderB;
try {
  orderA = await createOrder(buyerA);
  orderB = await createOrder(buyerB);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  report(1);
}
const roomB = sameRoom ? orderA : orderB;
const buyerForB = sameRoom ? buyerA : buyerB;
const expectB = sameRoom ? 1 : 0;

socketA = connect((event) => {
  if (event?.orderId === orderA) receivedA += 1;
});
socketB = connect((event) => {
  if (event?.orderId === orderA) receivedB += 1;
});

try {
  await Promise.all([once(socketA, "connect"), once(socketB, "connect")]);

  const ackA = await join(socketA, { orderId: orderA, buyerId: buyerA });
  const ackB = await join(socketB, { orderId: roomB, buyerId: buyerForB });
  if (!ackA?.ok || !ackB?.ok) {
    console.error("join refused");
    report(1);
  }

  const patched = await fetch(`${base}/orders/${orderA}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "packed" }),
  });
  if (!patched.ok) {
    console.error(`status change failed: ${patched.status}`);
    report(1);
  }

  const deadline = Date.now() + 2000;
  let seenAAt = 0;
  while (Date.now() < deadline) {
    if (receivedA >= 1 && seenAAt === 0) seenAAt = Date.now();
    if (expectB === 1 && receivedA >= 1 && receivedB >= 1) break;
    if (expectB === 0 && seenAAt !== 0 && Date.now() - seenAAt >= 400) break;
    await delay(30);
  }

  report(receivedA === 1 && receivedB === expectB ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  report(1);
}

function connect(onStatus) {
  const socket = io(base, { transports: ["websocket", "polling"] });
  socket.on("order.status", onStatus);
  socket.on("connect_error", (err) => {
    console.error(err.message);
    report(1);
  });
  return socket;
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 3000);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function join(socket, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join timeout")), 3000);
    socket.emit("join", payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

async function createOrder(buyerId) {
  const response = await fetch(`${base}/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": `realtime-${buyerId}-${Date.now()}-${Math.random()}`,
    },
    body: JSON.stringify({
      buyer_id: buyerId,
      items: [{ product_id: productId, quantity: 1 }],
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.detail ?? body.title ?? `create order failed: ${response.status}`);
  }
  return body.id;
}

function report(code) {
  console.log(`A_RECEIVED=${receivedA}`);
  console.log(`B_RECEIVED=${receivedB}`);
  socketA?.close();
  socketB?.close();
  process.exit(code);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
