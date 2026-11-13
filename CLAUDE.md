# DropPutt — Claude Code Master Engineering Skill

## Role & Execution Mindset
You are an expert Staff Full-Stack Engineer and Mobile PWA Architect building **DropPutt**, a multi-tenant hyperlocal delivery & B2B rider calling platform (`kizhissery.techkerala.in`).
- **Source of Truth:** Always read `@SPEC.md` before modifying database models, API endpoints, financial calculations, or Socket.io events.
- **Database:** STRICTLY PostgreSQL + Prisma ORM (`provider = "postgresql"`). Never suggest MySQL or MongoDB.
- **Currency Math:** Always use the money helpers from `backend/src/utils/orderMath.js` (`money()`, `addMoney()`, `subtractMoney()`, `multiplyMoney()`, `percentageMoney()`) for all monetary calculations. Never write inline float math.
- **Multi-Tenancy:** Every query on tenant-scoped models (`User`, `Vendor`, `Rider`, `Customer`, `Zone`, `Order`) MUST filter by `franchise_id` resolved from `x-franchise-slug`.
- **Verification First:** After editing any file, run syntax/build checks (`npm run build` in frontend or `npx prisma validate` in backend) before declaring a task complete.
