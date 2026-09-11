# ARGOS TRANSFER

Transferencia directa de archivos entre tu notebook y tu PC, por la LAN, sin Drive y sin Proximity.

Arrastrás un archivo a la ventana (o a la tira del borde del escritorio) y viaja cifrado por Wi-Fi/Ethernet a la otra máquina. Portable, sin permisos de administrador y sin drivers.

## Por qué esta forma

Las dos PCs están en la misma red. ARGOS descubre el otro equipo, abre un canal TLS 1.3 y copia el archivo a `Descargas/Argos Transfer`. En una notebook corporativa corre como usuario normal: no instala servicios, no toca el registro de máquina y no pide UAC.

Dos modos de uso:

- **Misma red (este repo):** notebook → Wi-Fi/LAN → PC. Máxima velocidad.
- **Si el Wi-Fi aísla clientes:** conectás a mano por IP de la PC casa. Sigue siendo un TCP saliente, que suele estar permitido.

## Descargar el exe (recomendado en la notebook de trabajo)

En [Releases](https://github.com/jesualavila-stack/argos-transfer/releases/latest) está `ArgosTransfer-1.0.0-portable.exe`.

Copiá el archivo a las dos PCs y abrilo con doble clic. No instala nada, no pide administrador y no deja servicios. En la notebook corporativa esta es la vía más simple.

Si preferís el código (Cursor en la notebook):

## Requisitos

- Windows 10/11
- Node.js 20.19+ (en esta PC ya sirve 22/24)
- Las dos máquinas en la misma LAN
- ARGOS abierto en **las dos** (en la PC casa puede quedar en la bandeja)

En la notebook de trabajo: instalá solo Node si Cursor todavía no lo tiene. No hace falta Rust, Go ni admin.

## Cómo levantarlo desde la notebook

```bash
git clone https://github.com/jesualavila-stack/argos-transfer.git
cd argos-transfer
npm install
npm run dev
```

En la PC casa, lo mismo. La primera vez, Windows puede preguntar si permitís la app en redes privadas. Elegí **redes privadas**. Eso no es un permiso de administrador.

1. En cada máquina abrí ⚙ y poné un nombre claro: `Notebook Trabajo` y `PC Casa`.
2. Dejá el **mismo PIN** en las dos. El default de fábrica es `247467` (ARGOS en el teclado). Cambialo si hay invitados en el Wi-Fi.
3. Cuando el otro equipo aparezca como *Conectada*, arrastrá archivos o usá **Enviar a …**.

## App portable (sin instalador)

En una máquina sin restricciones (esta PC casa):

```bash
npm run dist
```

Queda `dist/ArgosTransfer-1.0.0-portable.exe`. Copiá ese exe a la notebook (USB, el propio ARGOS, o GitHub Releases). Doble clic. No instala nada.

Los datos de la versión portable viven en `argos-data/` al lado del exe: identidad, PIN y certificados. No usa Program Files.

## Enviar a → PC Casa

Con el **.exe portable** abierto:

1. ⚙ → **Agregar Enviar a → PC Casa**
2. En el Explorador: clic derecho en un archivo → **Enviar a** → **Argos Transfer — PC Casa**

Eso escribe un `.cmd` en `%APPDATA%\Microsoft\Windows\SendTo`. Es por usuario, sin admin.

Desde `npm run dev` el atajo no se instala a propósito: hace falta el exe.

## Zona de lanzamiento

Una tira fina queda pegada al borde derecho. Arrastrás un archivo ahí y se envía al primer dispositivo visto (o al último usado). Doble clic abre la ventana. Se puede apagar desde ⚙ o desde el icono de la bandeja.

## Carpeta automática

Por defecto llega a `Descargas/Argos Transfer`. Se cambia en ajustes. Las carpetas se recrean con su estructura relativa.

## Si no se ven entre sí

1. Confirmá que ARGOS está abierto en las dos.
2. Mismo PIN.
3. El firewall de Windows bloqueó el aviso la primera vez: permití redes privadas.
4. Algunas redes corporativas aíslan Wi-Fi (client isolation). En la PC casa, `ipconfig` → IPv4, y en la notebook: ⚙ → **Conectar por IP**.
5. Dirección típica: la notebook **envía** (salida) y la PC casa **recibe** (escucha). Si la notebook no puede abrir un puerto, igual puede mandar.

## Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Desarrollo |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Protocolo de frames |
| `npm run dist` | Exe portable x64 |

## Seguridad

- TLS 1.3 en la transferencia.
- PIN compartido (cambialo).
- Certificado propio por dispositivo, guardado en datos de usuario.
- El receptor escribe solo dentro de la carpeta configurada (`..` se descarta).
- No hay cuenta en la nube ni telemetría.

Es una herramienta personal. No la dejes con el PIN de fábrica en una red con desconocidos.

## Cerrar / bandeja

Cerrar la ventana **no** cierra ARGOS: sigue recibiendo desde la bandeja. Para salir: clic derecho en el icono → **Salir**.
