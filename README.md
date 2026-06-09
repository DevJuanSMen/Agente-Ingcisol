# PROCURA AI

Sistema inteligente de gestión de compras para empresas de construcción colombianas.

## Requisitos previos

- Docker Desktop 4.x+
- Node.js 20 LTS (solo para desarrollo local sin Docker)
- Git

## Arranque rápido

```bash
# 1. Clonar y entrar al directorio
cd procura-ai

# 2. Copiar variables de entorno
cp .env.example .env
# Editar .env con tus valores reales (JWT_SECRET como mínimo)

# 3. Levantar todos los servicios
docker compose up --build
```

Servicios disponibles:
- **Frontend**: http://localhost:3000
- **API**: http://localhost:4000/api/health
- **A través de Caddy**: http://localhost
- **Prisma Studio**: `npx prisma studio` (dentro del container api)

## Migraciones y seed

```bash
# Ejecutar migraciones de base de datos
docker compose exec api npx prisma migrate dev --name init

# Seed: crea empresa y usuario Director de prueba
docker compose exec api node prisma/seed.js

# Abrir Prisma Studio (interfaz visual de BD)
docker compose exec api npx prisma studio --browser none
```

Credenciales del seed:
- **Email**: director@ingcisol.com
- **Password**: Director2026!

## Comandos útiles

```bash
# Ver logs de un servicio
docker compose logs -f api

# Reiniciar solo el backend
docker compose restart api

# Acceder a la shell del container api
docker compose exec api sh

# Regenerar cliente Prisma tras cambios al schema
docker compose exec api npx prisma generate

# Detener todo
docker compose down

# Detener y borrar volúmenes (resetea la BD)
docker compose down -v
```

## Estructura del proyecto

```
procura-ai/
├── server/          # Express API + Worker de cron jobs
│   ├── modules/     # Módulos de negocio (auth, users, projects, etc.)
│   ├── shared/      # Middlewares, utils, clientes de BD/Redis
│   └── prisma/      # Schema y migraciones de PostgreSQL
└── client/          # React + Vite + Tailwind CSS
    └── src/
        ├── pages/   # Páginas por módulo
        ├── components/  # Layout y UI reutilizable
        ├── api/     # Cliente Axios
        └── store/   # Estado global (Zustand)
```

## Variables de entorno requeridas

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Conexión PostgreSQL |
| `REDIS_URL` | Conexión Redis |
| `JWT_SECRET` | Secreto para firmar JWT (mín. 32 chars) |
| `ANTHROPIC_API_KEY` | API Key de Claude (cotizaciones con IA) |

El resto (Twilio, SendGrid, R2) tienen TODOs en el código — se activan en la Fase 2.
