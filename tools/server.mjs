import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 5173);
const contentTypes = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".png": "image/png",
};

createServer(async (request, response) => {
	try {
		const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
		const requestedPath = pathname === "/" ? "/index.html" : pathname;
		const filePath = resolve(root, `.${requestedPath}`);
		const relativePath = relative(root, filePath);

		if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
			response.writeHead(403).end("Forbidden");
			return;
		}

		const file = await readFile(filePath);
		response.writeHead(200, {
			"Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
			"Cache-Control": "no-cache",
		});
		response.end(file);
	} catch {
		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Arquivo não encontrado. Execute pnpm dev para compilar e servir o emulador.");
	}
}).listen(port, "127.0.0.1", () => {
	console.log(`Emulador disponível em http://localhost:${port}`);
});
