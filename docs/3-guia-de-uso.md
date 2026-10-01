# OpenWorks Candidates — Guía de uso

## Links

| Qué | Dirección |
|---|---|
| Admin (vos) | https://openworks-candidates.vercel.app/admin/ |
| Link de cliente | https://openworks-candidates.vercel.app/?p=SLUG (lo copiás desde el admin) |
| Supabase (base de datos) | https://supabase.com/dashboard/project/ciifambosbnoqqagtfpp |
| Vercel (hosting) | https://vercel.com/dashboard |
| Código | GitHub → VictoriaDolly/OpenWorks---Candidates (privado) |

## Rutina diaria

**Cliente nuevo / rol nuevo**
1. Admin → **+ New Pipeline** → Client Name + Role Title → **Create Pipeline**.
2. Anotá la contraseña (se muestra solo en esa sesión; después solo se puede resetear en **Edit Pipeline**).

**Presentar un candidato**
1. En tu proyecto "OpenWorks Import Assistant" de Claude: adjuntá Highlights + Resume → copiá el JSON (ver `2-import-assistant.md`).
2. Admin → pipeline → **Import from JSON** → pegar → **Import**.
3. Click en el candidato → **Edit** → **Upload PDF** (el Resume) → **Save Candidate**.
4. **Publish to Client Link**.
5. Primera vez con ese cliente: **Copy Link + Password** y mandáselo.

**Mover etapas según el feedback**
1. Admin → pipeline → click en el candidato → abajo leés las notas del cliente.
2. Cambiá la etapa en el selector (se guarda al instante).
3. **Publish to Client Link** (el cliente no ve cambios hasta que publicás; el badge amarillo "Unpublished changes" te lo recuerda).

## Bueno saber

- **Sesión del admin:** se mantiene en ese navegador. Si te pide entrar de nuevo, pedí otro magic link (plan gratis: pocos emails por hora).
- **Agregar otro admin:** Supabase → SQL Editor → `insert into admins (email) values ('nuevo@email.com');` y crear el usuario en Authentication → Users (Auto Confirm). En el plan gratis, ese email tiene que estar invitado a tu organización de Supabase para recibir magic links (Organization → Team → Invite), o configurar un SMTP propio.
- **Supabase gratis se pausa** si pasa ~1 semana sin uso. Si el sitio deja de cargar datos, entrá al dashboard de Supabase y tocá **Restore project**.
- **Cambiar la contraseña de un cliente:** Edit Pipeline → Generate → Save. La vieja deja de funcionar al instante.
- **Seguridad:** la contraseña es compartida (quien la tenga puede entrar) y los links de los Resume se pueden reenviar. Las notas solo las borra el navegador que las escribió.
