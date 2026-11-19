// Agent bridge for Chocolate Doom (GPL-2.0-or-later, same license as the engine).
// Original code written for this project. It is compiled into src/doom/ by build.sh.
// It exposes a compact tactical observation, a control bitmask, pause and speed.
// Keyboard and mouse never reach the game: those SDL events are disabled below.

#include <stdio.h>
#include <string.h>

#include <emscripten.h>
#include <SDL.h>

#include "doomstat.h"
#include "p_local.h"
#include "r_main.h"
#include "tables.h"
#include "d_event.h"
#include "d_ticcmd.h"
#include "i_timer.h"
#include "i_video.h"

extern int agent_speed;
extern int agent_paused;

#define FORWARD 1
#define BACK 2
#define STRAFE_L 4
#define STRAFE_R 8
#define TURN_L 16
#define TURN_R 32
#define FIRE 64
#define USE 128

#define MAX_THINGS 8
#define PICKUP_RANGE 768

extern boolean main_loop_started;

static int mask;
static char json[4096];

// Runs before main(), so before SDL creates its event listeners.
__attribute__((constructor)) static void agent_early(void)
{
#ifndef AGENT_DEBUG
    SDL_SetHint(SDL_HINT_EMSCRIPTEN_KEYBOARD_ELEMENT, "#agent-no-keyboard");
#endif
}

void agent_bridge_init(void)
{
    static const Uint32 blocked[] = {
        SDL_KEYDOWN, SDL_KEYUP, SDL_TEXTINPUT, SDL_MOUSEMOTION,
        SDL_MOUSEBUTTONDOWN, SDL_MOUSEBUTTONUP, SDL_MOUSEWHEEL,
        SDL_JOYAXISMOTION, SDL_JOYBUTTONDOWN, SDL_JOYBUTTONUP, SDL_JOYHATMOTION,
    };
    for (unsigned i = 0; i < sizeof(blocked) / sizeof(*blocked); i++)
    {
        SDL_EventState(blocked[i], SDL_DISABLE);
    }
}

// Run a frame only when game time moved, so TryRunTics never spins waiting for a tic.
void D_RunFrame(void);
void agent_frame(void)
{
    static int last = -1;
    int now = I_GetTime();

    if (agent_paused)
    {
        // Redraw the frozen scene after SDL resizes or clears the canvas.
        I_FinishUpdate();
        return;
    }
    if (now == last)
    {
        return;
    }
    last = now;
    D_RunFrame();
}

void agent_build_ticcmd(ticcmd_t *cmd)
{
    if (mask & FORWARD)  cmd->forwardmove += 0x32;
    if (mask & BACK)     cmd->forwardmove -= 0x32;
    if (mask & STRAFE_R) cmd->sidemove += 0x28;
    if (mask & STRAFE_L) cmd->sidemove -= 0x28;
    if (mask & TURN_L)   cmd->angleturn += 640;
    if (mask & TURN_R)   cmd->angleturn -= 640;
    if (mask & FIRE)     cmd->buttons |= BT_ATTACK;
    if (mask & USE)      cmd->buttons |= BT_USE;
}

void A_Chase();

// True while mo is in its missile or melee state chain. The chain ends where the
// run states begin (they call A_Chase), so walking or turning to chase is not an attack.
static int in_chain(mobj_t *mo, int first)
{
    state_t *s = &states[first];
    for (int i = 0; first && i < 20 && s != &states[S_NULL] && s->action.acp1 != (actionf_p1) A_Chase; i++, s = &states[s->nextstate])
    {
        if (mo->state == s) return 1;
    }
    return 0;
}

static int rel_angle(mobj_t *from, mobj_t *to)
{
    angle_t a = R_PointToAngle2(from->x, from->y, to->x, to->y) - from->angle;
    return (int) ((int32_t) a * (360.0 / 4294967296.0));
}

EMSCRIPTEN_KEEPALIVE int agent_ready(void)
{
    return main_loop_started && players[consoleplayer].mo != NULL;
}

EMSCRIPTEN_KEEPALIVE void agent_set_controls(int m) { mask = m; }
EMSCRIPTEN_KEEPALIVE void agent_set_paused(int p) { agent_paused = p; }
// Only 1, 2, 4 and 8 are accepted; anything else is ignored and the speed stays as it was.
EMSCRIPTEN_KEEPALIVE void agent_set_speed(int s)
{
    if (s == 1 || s == 2 || s == 4 || s == 8)
    {
        agent_speed = s;
    }
}

#ifdef AGENT_DEBUG
// Test-only. Compiled into tests/debug-engine/, never into public/engine/.
EMSCRIPTEN_KEEPALIVE void agent_debug_spawn(int type, int dist)
{
    mobj_t *me = players[consoleplayer].mo;
    int a = me->angle >> ANGLETOFINESHIFT;
    mobj_t *mo = P_SpawnMobj(me->x + dist * finecosine[a], me->y + dist * finesine[a], ONFLOORZ, type);

    mo->target = me;
    P_SetMobjState(mo, mo->info->seestate);
}

EMSCRIPTEN_KEEPALIVE void agent_debug_enable_input(void)
{
    SDL_EventState(SDL_KEYDOWN, SDL_ENABLE);
    SDL_EventState(SDL_KEYUP, SDL_ENABLE);
}
#endif

EMSCRIPTEN_KEEPALIVE const char *agent_observe(void)
{
    player_t *pl = &players[consoleplayer];
    mobj_t *me = pl->mo;
    char *p = json, *end = json + sizeof(json) - 256;
    int mons = 0, picks = 0;

    p += snprintf(p, 512,
        "{\"health\":%d,\"armor\":%d,\"ammo\":%d,\"weapon\":%d,\"x\":%d,\"y\":%d,"
        "\"angle\":%d,\"gametic\":%d,\"speed\":%d,\"paused\":%s,\"monsters\":[",
        pl->health, pl->armorpoints,
        weaponinfo[pl->readyweapon].ammo == am_noammo ? -1 : pl->ammo[weaponinfo[pl->readyweapon].ammo],
        pl->readyweapon, me ? me->x >> FRACBITS : 0, me ? me->y >> FRACBITS : 0,
        me ? (int) ((int32_t) me->angle * (360.0 / 4294967296.0)) : 0,
        gametic, agent_speed, agent_paused ? "true" : "false");

    // shortcut: first 8 live monsters in thinker order, not nearest; sort by dist if the AI needs it.
    for (thinker_t *t = thinkercap.next; me && t != &thinkercap && p < end; t = t->next)
    {
        if (t->function.acp1 != (actionf_p1) P_MobjThinker) continue;
        mobj_t *mo = (mobj_t *) t;
        int dist = P_AproxDistance(mo->x - me->x, mo->y - me->y) >> FRACBITS;

        if ((mo->flags & MF_COUNTKILL) && mo->health > 0 && mons < MAX_THINGS && P_CheckSight(me, mo))
        {
            int att = mo->target == me && (in_chain(mo, mo->info->missilestate) || in_chain(mo, mo->info->meleestate));
            p += snprintf(p, 128, "%s{\"dist\":%d,\"angle\":%d,\"health\":%d,\"attacking\":%s}",
                          mons++ ? "," : "", dist, rel_angle(me, mo), mo->health, att ? "true" : "false");
        }
    }
    p += snprintf(p, 32, "],\"pickups\":[");
    for (thinker_t *t = thinkercap.next; me && t != &thinkercap && p < end; t = t->next)
    {
        if (t->function.acp1 != (actionf_p1) P_MobjThinker) continue;
        mobj_t *mo = (mobj_t *) t;
        int dist = P_AproxDistance(mo->x - me->x, mo->y - me->y) >> FRACBITS;

        if ((mo->flags & MF_SPECIAL) && dist < PICKUP_RANGE && picks < MAX_THINGS)
        {
            p += snprintf(p, 64, "%s{\"dist\":%d,\"angle\":%d}", picks++ ? "," : "", dist, rel_angle(me, mo));
        }
    }
    snprintf(p, 8, "]}");
    return json;
}
