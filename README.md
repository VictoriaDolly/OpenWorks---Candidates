# Candidates — tablero de candidatos para clientes

Sitio estático (HTML + JavaScript, sin build ni `npm install`) con dos partes:

- **Admin** (`/admin/`): creás pipelines (cliente + rol), cargás candidatos (a mano o importando JSON en inglés y español), publicás, congelás o eliminás.
- **Link del cliente** (`/?p=SLUG` + contraseña): el cliente ve el tablero de candidatos en inglés o español y deja feedback.

Backend: **Supabase** (base de datos, login del admin por magic link, CVs en PDF). Hosting: **Vercel**.

---

## Montar tu propia copia (≈ 20 minutos)

Necesitás cuentas propias (gratis) en **GitHub**, **Supabase** y **Vercel**.

### 1. Copiar el código a tu GitHub

Con acceso al repositorio original, la forma más simple:

- Si el dueño lo marcó como plantilla (*Settings → General → Template repository*): botón **Use this template → Create a new repository** → elegí tu cuenta, ponelo **Private**.
- Si no: clonalo y subilo a un repo nuevo y vacío de tu cuenta:
  ```powershell
  git clone https://github.com/VictoriaDolly/OpenWorks---Candidates.git mi-candidates
  cd mi-candidates
  git remote set-url origin https://github.com/TU-USUARIO/TU-REPO.git
  git push -u origin main
  ```

### 2. Crear la base de datos en Supabase

1. supabase.com → **New project** (anotá la región; cualquier plan sirve).
2. Abrí [`docs/supabase-setup.sql`](docs/supabase-setup.sql) y en la línea del `insert into admins` reemplazá `TU-EMAIL@ejemplo.com` por **tu** email (el que vas a usar para entrar al admin).
3. Supabase → **SQL Editor** → New query → pegá **todo** el archivo → **Run**. Debe decir *Success*.
   - Solo este archivo. Los `docs/migration-*.sql` son para proyectos viejos; no hacen falta.
4. **Authentication → Users → Add user → Create new user**: tu email, cualquier contraseña, tildá **Auto Confirm User**.
5. **Authentication → URL Configuration**: lo completás en el paso 4, cuando tengas el dominio de Vercel.

### 3. Conectar el código a TU Supabase

Editá [`public/js/config.js`](public/js/config.js) con los datos de **tu** proyecto (Supabase → **Project Settings → API**):

```js
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_…';   // la "publishable" / anon key — NUNCA la secret / service_role
export const PUBLIC_SITE_URL = '';                    // vacío = usa el dominio donde abras el admin
```

> ⚠️ Si no cambiás este archivo, tu copia se conecta a la base de datos del sitio original.

Guardá, hacé commit y push a tu repo.

### 4. Publicar en Vercel

1. vercel.com → **Add New → Project** → importá tu repo.
2. **Framework Preset: Other**. No pongas build command ni output directory: [`vercel.json`](vercel.json) ya indica que se sirve la carpeta `public`.
3. **Deploy**. Te da un dominio, p. ej. `https://mi-candidates.vercel.app`.
4. Volvé a Supabase → **Authentication → URL Configuration**:
   - **Site URL**: `https://mi-candidates.vercel.app`
   - **Redirect URLs** → Add URL: `https://mi-candidates.vercel.app/admin/` (con la barra final)

### 5. Probar

1. Abrí `https://mi-candidates.vercel.app/admin/` → tu email → **Send magic link** → abrí el link del correo **en el mismo navegador**.
2. **+ New Pipeline** → creá uno de prueba → **+ Add Candidate** → **Publish to Client Link**.
3. **Copy Link + Password** → abrilo en una ventana de incógnito → entrá con la contraseña.

Listo. El uso diario está en [`docs/3-guia-de-uso.md`](docs/3-guia-de-uso.md) y el asistente que genera los JSON en [`docs/2-import-assistant.md`](docs/2-import-assistant.md).

---

## Bueno saber

- **Emails de login (plan gratis):** Supabase solo manda magic links a emails que son miembros de tu organización de Supabase, y pocos por hora. Para otro admin: invitalo en *Organization → Team*, agregalo con `insert into admins (email) values ('otro@email.com');` y creá su usuario (paso 2.4). O configurá un SMTP propio en *Authentication → Emails*.
- **Supabase gratis se pausa** tras ~1 semana sin uso: entrá al dashboard y tocá **Restore project**.
- **Logos y colores:** `public/assets/` y las variables al principio de `public/css/styles.css`. El favicon son los `favicon*` de `public/assets/`.
- **Probar en tu compu (opcional, Windows):** `powershell -ExecutionPolicy Bypass -File tools/serve.ps1` y abrí `http://localhost:5173`. Usa la base de datos configurada en `config.js`.

## Estructura

| Carpeta / archivo | Qué es |
|---|---|
| `public/` | Todo lo que se publica (Vercel sirve esta carpeta) |
| `public/js/` | Código del link del cliente + compartido (tablero, idiomas, config) |
| `public/admin/` | Código del admin (login, pipelines, candidatos, import) |
| `docs/supabase-setup.sql` | Base de datos completa para un proyecto nuevo |
| `docs/` | Guía de uso, Import Assistant, migraciones |
| `tools/` | Servidor local y simulador de Supabase (solo desarrollo) |
