#include <emscripten.h>
#include <stdint.h>

#include "doomgeneric.h"
#include "doomstat.h"

EMSCRIPTEN_KEEPALIVE int player_x(void) {
    return players[consoleplayer].mo ? players[consoleplayer].mo->x : 0;
}

EMSCRIPTEN_KEEPALIVE int player_y(void) {
    return players[consoleplayer].mo ? players[consoleplayer].mo->y : 0;
}

static unsigned short queue[256];
static unsigned int readpos;
static unsigned int writepos;

EMSCRIPTEN_KEEPALIVE void key_event(int down, int key) {
    unsigned int next = (writepos + 1) % 256;
    if (next != readpos) {
        queue[writepos] = (down << 8) | key;
        writepos = next;
    }
}

void DG_Init(void) {}

EM_JS(void, present, (const void *pixels), {
    Module.present(HEAPU8, pixels);
});

void DG_DrawFrame(void) {
    present(DG_ScreenBuffer);
}

void DG_SleepMs(uint32_t ms) {
    emscripten_sleep(ms);
}

uint32_t DG_GetTicksMs(void) {
    return (uint32_t)emscripten_get_now();
}

int DG_GetKey(int *pressed, unsigned char *key) {
    if (readpos == writepos) {
        return 0;
    }

    unsigned short event = queue[readpos];
    readpos = (readpos + 1) % 256;
    *pressed = event >> 8;
    *key = event & 255;
    return 1;
}

void DG_SetWindowTitle(const char *title) {}

int main(int argc, char **argv) {
    doomgeneric_Create(argc, argv);
    emscripten_set_main_loop(doomgeneric_Tick, 35, 1);
    return 0;
}
