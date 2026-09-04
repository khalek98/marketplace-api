export function startServer({ app, port, host } = {}) {
  const listenPort = port ?? Number(process.env.PORT ?? 3000);

  return new Promise((resolve, reject) => {
    const server =
      host === undefined
        ? app.listen(listenPort)
        : app.listen(listenPort, host);

    server.once("error", reject);
    server.once("listening", () => resolve(server));
  });
}

export function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
