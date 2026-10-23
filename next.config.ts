import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Fija la raíz del workspace a este proyecto (evita que Next infiera un
  // lockfile externo cuando hay varios package-lock.json en el sistema).
  turbopack: {
    root: path.join(__dirname),
  },
  // Clientes con JS en caché aún llaman /api/soroswap/*; los mandamos al agregador
  // nativo /api/swap/* (antes apuntaban a /api/sdex/{quote,build}, que ya no existen → 404).
  async rewrites() {
    return [
      { source: "/api/soroswap/quote", destination: "/api/swap/quote" },
      { source: "/api/soroswap/build", destination: "/api/swap/build" },
      { source: "/api/soroswap/send", destination: "/api/swap/send" },
    ];
  },
};

export default nextConfig;
