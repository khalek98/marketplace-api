# Upstream dxflrs/garage has no shell, so a layout + key import cannot be
# sequenced there. This image adds a shell and Node only to run bootstrap.
FROM dxflrs/garage:v2.1.0 AS garage

FROM node:22-alpine
COPY --from=garage /garage /usr/local/bin/garage
COPY garage.toml /etc/garage.toml
COPY bootstrap.mjs /opt/bootstrap.mjs
COPY entrypoint.sh /entrypoint.sh
EXPOSE 9000 3903
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
