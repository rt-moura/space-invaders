# Emulador de Space Invaders

Emulador do jogo de arcade original Space Invaders, executado no navegador. Inclui um depurador da CPU com registradores, histórico de instruções, pausa e execução passo a passo.

## Requisitos

- Node.js
- pnpm
- Os quatro arquivos da ROM: `invaders.h`, `invaders.g`, `invaders.f` e `invaders.e`

As ROMs não estão incluídas no projeto.

## Como executar

```sh
pnpm install
pnpm dev
```

Abra o endereço local exibido no terminal (por padrão, `http://localhost:5173`). Clique em **Load ROM** e selecione os quatro arquivos de ROM de uma só vez. O emulador confere os nomes e carrega os arquivos na ordem esperada.

## Controles

| Ação                          | Jogador 1 | Jogador 2              |
| ----------------------------- | --------- | ---------------------- |
| Mover para a esquerda/direita | `A` / `D` | Setas esquerda/direita |
| Atirar                        | `Space`   | `Numpad 0`             |
| Iniciar                       | `2`       | `3`                    |

Pressione `1` para inserir uma ficha. `Ctrl` ativa o tilt.

Use **Pause** para pausar ou retomar a emulação. Com ela pausada, **Step instruction** executa uma instrução da CPU.

## Licença

O código-fonte do emulador está sob a [licença MIT]. ROMs e outros materiais de terceiros não estão cobertos por essa licença.
