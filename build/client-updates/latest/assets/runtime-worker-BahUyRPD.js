const le=class le{constructor(e=le.DEFAULT_MAX_QUEUE_SIZE){this.queue=[],this.pendingRequests=[];const t=Number.isInteger(e)&&e>0?e:le.DEFAULT_MAX_QUEUE_SIZE;this.maxQueueSize=t}enqueueTokens(e){if(!(!Array.isArray(e)||e.length===0))for(const t of e){const n=this.normalizeToken(t);if(!n)continue;const o=this.pendingRequests.findIndex(s=>this.canSatisfyRequest(n,s.kind));if(o>=0){const[s]=this.pendingRequests.splice(o,1);if(!s)continue;s.resolve({requestKind:s.kind,token:n,cancelled:!1,cancelCode:null,consumedFromQueue:!1});continue}if(this.queue.length>=this.maxQueueSize){console.log(`RuntimeInputBroker queue full (${this.maxQueueSize}); dropping input token "${n.key}"`);continue}this.queue.push(n)}}requestNext(e){const t=this.queue.findIndex(n=>this.canSatisfyRequest(n,e));if(t>=0){const[n]=this.queue.splice(t,1);return{requestKind:e,token:n||null,cancelled:!1,cancelCode:null,consumedFromQueue:!0}}return new Promise(n=>{this.pendingRequests.push({kind:e,createdAt:Date.now(),resolve:n})})}cancelAll(e){for(;this.pendingRequests.length>0;){const t=this.pendingRequests.shift();t&&t.resolve({requestKind:t.kind,token:null,cancelled:!0,cancelCode:e,consumedFromQueue:!1})}}drain(){if(this.queue.length===0)return[];const e=[...this.queue];return this.queue.length=0,e}dequeueToken(e="event"){const t=this.queue.findIndex(o=>this.canSatisfyRequest(o,e));if(t<0)return null;const[n]=this.queue.splice(t,1);return n||null}prependToken(e){const t=this.normalizeToken(e);t&&(this.queue.length>=this.maxQueueSize&&this.queue.pop(),this.queue.unshift(t))}hasPendingRequests(e){return e?this.pendingRequests.some(t=>t.kind===e):this.pendingRequests.length>0}normalizeToken(e){return!e||typeof e.key!="string"||e.key.length===0?null:e.targetKinds!==void 0&&e.targetKinds!=="any"&&(!Array.isArray(e.targetKinds)||e.targetKinds.length===0)?{...e,targetKinds:"any"}:{...e,targetKinds:e.targetKinds??"any"}}canSatisfyRequest(e,t){const n=e.targetKinds??"any";return n==="any"?!0:n.includes(t)}};le.DEFAULT_MAX_QUEUE_SIZE=256;let De=le;var wt=`&# cmdhelp
&	Tell what command a keystroke invokes
^	Show the type of an adjacent trap
^[	Cancel command (same as ESCape key)
&? debug
^E	Search for nearby traps, secret doors, and unseen monsters
^F	Map level; reveals traps and secret corridors but not secret doors
^G	Create a monster by name or class
^I	View inventory with all items identified
^O	List special level locations
^V	Teleport between levels
^W	Wish for something
&: #!debug
^E	unavailable debugging command
^F	unavailable debugging command
^G	unavailable debugging command
^I	unavailable debugging command
^O	Shortcut for '#overview': list interesting levels you have visited
^V	unavailable debugging command
^W	unavailable debugging command
&. #?debug
&? number_pad=0,-1
b	Go southwest 1 space
B	Go southwest until you are on top of something
h	Go west 1 space
H	Go west until you are on top of something
j	Go south 1 space
J	Go south until you are on top of something
k	Go north 1 space
K	Go north until you are on top of something
l	Go east 1 space
L	Go east until you are on top of something
n	Go southeast 1 space
N	Go southeast until you are on something
u	Go northeast 1 space
U	Go northeast until you are on top of something
&# y,Y handled below
&: #number_pad=1,2,3,4
h	Help: synonym for '?'
j	Jump: shortcut for '#jump'
k	Kick: synonym for '^D'
l	Loot: shortcut for '#loot'
n	Start a count; continue with digit(s)
N	Name: shortcut for '#name'
u	Untrap: shortcut for '#untrap'
&. #0,-1 vs 1,2,3,4
a	Apply (use) a tool or break a wand
A	Remove all armor and/or all accessories and/or unwield weapons
^A	Redo the previous command
^B	Go southwest until you are near something
c	Close a door
C	Call (name) a monster, an individual object, or a type of object
^C	Interrupt: quit the game
d	Drop an item
D	Drop specific item types
^D	Kick something (usually a door, chest, or box)
e	Eat something
E	Engrave writing on the floor
f	Fire ammunition from quiver
F	Followed by direction, fight a monster (even if you don't sense it)
g	Followed by direction, move until you are near something
G	Followed by direction, same as control-direction
^H	Go west until you are near something
i	Show your inventory
I	Inventory specific item types
^J	Go south until you are near something
^K	Go north until you are near something
^L	Go east until you are near something
m	Followed by direction, move without picking anything up or fighting
M	Followed by direction, move a distance without picking anything up
^N	Go southeast until you are near something
o	Open a door
O	Show option settings, possibly change them
p	Pay your shopping bill
P	Put on an accessory (ring, amulet, etc; will work for armor too)
^P	Toggle through previously displayed game messages
q	Quaff (drink) something (potion, water, etc)
Q	Select ammunition for quiver (use '#quit' to quit)
r	Read a scroll or spellbook
R	Remove an accessory (ring, amulet, etc; will work for armor too)
^R	Redraw screen
s	Search all immediately adjacent locations for traps and secret doors
S	Save the game (and exit; there is no "save and keep going")
t	Throw something (choose an item, then a direction--not a target)
T	Take off one piece of armor (will work for accessories too)
^T	Teleport around level
^U	Go northeast until you are near something
v	Show version ('#version' shows more information)
V	Show history of game's development
w	Wield a weapon (for dual weapons: 'w' secondary, 'x', 'w' primary, 'X')
W	Wear a piece of armor (will work for accessories too)
x	Swap wielded and secondary weapons
X	Toggle two-weapon combat
^X	Show your attributes (shows more in debug or explore mode)
&? number_pad=0,1,2,3,4
&? number_pad=0
y	Go northwest 1 space
Y	Go northwest until you are on top of something
&.
^Y	Go northwest until you are near something
z	Zap a wand
Z	Zap (cast) a spell
&? suspend
^Z	Suspend game; 'fg' (foreground) to resume
&:
^Z	unavailable command: suspend
&.
&: number_pad=-1
y	Zap a wand
Y	Zap (cast) a spell
&? suspend
^Y	Suspend game; 'fg' (foreground) to resume
&:
^Y	unavailable command: suspend
&.
z	Go northwest 1 space
Z	Go northwest until you are on top of something
^Z	Go northwest until you are near something
&. #0,1..4 vs -1
<	Go up a staircase
>	Go down a staircase
/	Show what type of thing a symbol corresponds to
?	Give a help message
&? shell
!	Do a shell escape; 'exit' shell to come back
&:
!	unavailable command: shell
&.
\\	Show what object types have been discovered
\`	Show discovered types for one class of objects
_	Travel via a shortest-path algorithm to a point on the map
.	Rest one move while doing nothing
&? rest_on_space
 	Rest one move while doing nothing
&.
:	Look at what is on the floor
;	Show what type of thing a map symbol on the level corresponds to
,	Pick up things at the current location
@	Toggle the pickup option on/off
)	Show the weapon(s) currently wielded or readied
[	Show the armor currently worn
=	Show the ring(s) currently worn
"	Show the amulet currently worn
(	Show the tools currently in use
*	Show all equipment in use (combination of the ),[,=,",( commands)
$	Count your gold
+	List known spells
#	Perform an extended command (use '#?' to list choices)
&# number_pad:
&#  -1 = numpad off, swap y with z (including Y with Z, ^Y with ^Z, M-y &c)
&#   0 = numpad off (default)
&#   1 = numpad on, normal keypad layout, '5'->'g'
&#   2 = numpad on, normal keypad layout, '5'->'G'
&#   3 = numpad on, phone keypad layout, '5'->'g'
&#   4 = numpad on, phone keypad layout, '5'->'G'
&? number_pad = 1,2,3,4
0	Show inventory
4	Move west
6	Move east
-	'F' prefix; force fight
&: #-1,0
0	Continue a count
4	Start or continue a count
6	Start or continue a count
&. #1,2,3,4 vs -1,0
&? number_pad=1,2
7	Move northwest
8	Move north
9	Move northeast
1	Move southwest
2	Move south
3	Move southeast
&: number_pad=3,4
1	Move northwest
2	Move north
3	Move northeast
7	Move southwest
8	Move south
9	Move southeast
&: #-1,0
1	Start or continue a count
2	Start or continue a count
3	Start or continue a count
7	Start or continue a count
8	Start or continue a count
9	Start or continue a count
&. #1,2 vs 3,4 vs -1,0
&? number_pad=1,3
5	'g' movement prefix
M-5	'G' movement prefix
&: number_pad=2,4
5	'G' movement prefix
M-5	'g' movement prefix
M-0	Inventory specific item types
&: #-1,0
5	Start or continue a count
M-2	Toggle two-weapon combat
&. #1,3 vs 2,4 vs -1,0
M-?	Display extended command help (if the platform allows this)
M-a	Adjust inventory letters
M-A	Annotate: supply a name for the current dungeon level
M-c	Chat: talk to an adjacent creature
M-C	Conduct: list voluntary challenges you have maintained
M-d	Dip an object into something
M-e	Enhance: check weapons skills, advance them if eligible
M-f	Force a lock
M-i	Invoke an object's special powers
M-j	Jump to a nearby location
M-l	Loot a box on the floor
M-m	When polymorphed, use a monster's special ability
M-n	Name a monster, an individual object, or a type of object
M-N	Name a monster, an individual object, or a type of object
M-o	Offer a sacrifice to the gods
M-O	Overview: show a summary of the explored dungeon
M-p	Pray to the gods for help
M-q	Quit (exit without saving)
M-r	Rub a lamp or a touchstone
M-R	Ride: mount or dismount a saddled steed
M-s	Sit down
M-t	Turn undead
M-T	Tip: empty a container
M-u	Untrap something (trap, door, or chest)
M-v	Print compile time options for this version of NetHack
M-w	Wipe off your face
`,bt=`        Welcome to NetHack!                ( description of version 3.6 )

        NetHack is a Dungeons and Dragons like game where you (the adventurer)
descend into the depths of the dungeon in search of the Amulet of Yendor,
reputed to be hidden somewhere below the twentieth level.  You begin your
adventure with a pet that can help you in many ways, and can be trained
to do all sorts of things.  On the way you will find useful (or useless)
items, quite possibly with magic properties, and assorted monsters.  You can
attack a monster by trying to move onto the space a monster is on (but often
it is much wiser to leave it alone).

        Unlike most adventure games, which give you a verbal description of
your location, NetHack gives you a visual image of the dungeon level you are
on.

        NetHack uses the following symbols:

        - and |  The walls of a room, possibly also open doors or a grave.
        .        The floor of a room or a doorway.
        #        A corridor, or iron bars, or a tree, or possibly a kitchen
                 sink (if your dungeon has sinks), or a drawbridge.
        >        Stairs down: a way to the next level.
        <        Stairs up: a way to the previous level.
        @        You (usually), or another human.
        )        A weapon of some sort.
        [        A suit or piece of armor.
        %        Something edible (not necessarily healthy).
        /        A wand.
        =        A ring.
        ?        A scroll.
        !        A potion.
        (        Some other useful object (pick-axe, key, lamp...)
        $        A pile of gold.
        *        A gem or rock (possibly valuable, possibly worthless).
        +        A closed door, or a spellbook containing a spell
                 you can learn.
        ^        A trap (once you detect it).
        "        An amulet, or a spider web.
        0        An iron ball.
        _        An altar, or an iron chain.
        {        A fountain.
        }        A pool of water or moat or a pool of lava.
        \\        An opulent throne.
        \`        A boulder or statue.
        A to Z, a to z, and several others:  Monsters.
        I        Invisible or unseen monster's last known location

                 You can find out what a symbol represents by typing
                 '/' and following the directions to move the cursor
                 to the symbol in question.  For instance, a 'd' may
                 turn out to be a dog.


y k u   7 8 9   Move commands:
 \\|/     \\|/            yuhjklbn: go one step in specified direction
h-.-l   4-.-6           YUHJKLBN: go in specified direction until you
 /|\\     /|\\                        hit a wall or run into something
b j n   1 2 3           g<dir>:   run in direction <dir> until something
      numberpad                     interesting is seen
                        G<dir>,   same, except a branching corridor isn't
 <  up                  ^<dir>:     considered interesting (the ^ in this
                                    case means the Control key, not a caret)
 >  down                m<dir>:   move without picking up objects
                        F<dir>:   fight even if you don't sense a monster
                If the number_pad option is set, the number keys move instead.
                Depending on the platform, Shift number (on the numberpad),
                Meta number, or Alt number will invoke the YUHJKLBN commands.
                Control <dir> may or may not work when number_pad is enabled,
                depending on the platform's capabilities.
                Digit '5' acts as 'G' prefix, unless number_pad is set to 2
                in which case it acts as 'g' instead.
                If number_pad is set to 3, the roles of 1,2,3 and 7,8,9 are
                reversed; when set to 4, behaves same as 3 combined with 2.
                If number_pad is set to -1, alphabetic movement commands are
                used but 'y' and 'z' are swapped.

Commands:
        NetHack knows the following commands:
        ?       Help menu.
        /       What-is, tell what a symbol represents.  You may choose to
                specify a location or give a symbol argument.  Enabling the
                autodescribe option will give information about the symbol
                at each location you move the cursor onto.
        &       Tell what a command does.
        <       Go up a staircase (if you are standing on it).
        >       Go down a staircase (if you are standing on it).
        .       Rest, do nothing for one turn.
        _       Travel via a shortest-path algorithm to a point on the map.
        a       Apply (use) a tool (pick-axe, key, lamp...).
        A       Remove all armor.
        ^A      Redo the previous command.
        c       Close a door.
        C       Call (name) monster, individual object, or type of object.
        d       Drop something.  d7a:  drop seven items of object a.
        D       Drop multiple items.  This command is implemented in two
                different ways.  One way is:
                "D" displays a list of all of your items, from which you can
                pick and choose what to drop.  A "+" next to an item means
                that it will be dropped, a "-" means that it will not be
                dropped.  Toggle an item to be selected/deselected by typing
                the letter adjacent to its description.  Select all items
                with "+", deselect all items with "=".  The <SPACEBAR> moves
                you from one page of the listing to the next.
                The other way is:
                "D" will ask the question "What kinds of things do you want
                to drop? [!%= au]".  You should type zero or more object
                symbols possibly followed by 'a' and/or 'u'.
                Da - drop all objects, without asking for confirmation.
                Du - drop only unpaid objects (when in a shop).
                D%u - drop only unpaid food.
        ^D      Kick (for doors, usually).
        e       Eat food.
        E       Engrave a message on the floor.
                E- - write in the dust with your fingers.
        f       Fire ammunition from quiver.
        F       Followed by direction, fight a monster (even if you don't
                sense it).
        i       Display your inventory.
        I       Display selected parts of your inventory, as in
                I* - list all gems in inventory.
                Iu - list all unpaid items.
                Ix - list all used up items that are on your shopping bill.
                I$ - count your money.
        o       Open a door.
        O       Review current options and possibly change them.
                A menu displaying the option settings will be displayed
                and most can be changed by simply selecting their entry.
                Options are usually set before the game with NETHACKOPTIONS
                environment variable or via a configuration file (defaults.nh,
                NetHack Defaults, nethack.cnf, ~/.nethackrc, etc.) rather
                than with the 'O' command.
        p       Pay your shopping bill.
        P       Put on an accessory (ring, amulet, etc).
        ^P      Repeat last message (subsequent ^P's repeat earlier messages).
                The behavior can be varied via the msg_window option.
        q       Drink (quaff) something (potion, water, etc).
        Q       Select ammunition for quiver.
        #quit   Exit the program without saving the current game.
        r       Read a scroll or spellbook.
        R       Remove an accessory (ring, amulet, etc).
        ^R      Redraw the screen.
        s       Search for secret doors and traps around you.
        S       Save the game.  Also exits the program.
                [To restore, just play again and use the same character name.]
                [There is no "save current data but keep playing" capability.]
        t       Throw an object or shoot a projectile.
        T       Take off armor.
        ^T      Teleport, if you are able.
        v       Displays the version number.
        V       Display a longer identification of the version, including the
                history of the game.
        w       Wield weapon.  w- means wield nothing, use bare hands.
        W       Wear armor.
        x       Swap wielded and secondary weapons.
        X       Toggle two-weapon combat.
        ^X      Show your attributes.
        #explore  Switch to Explore Mode (aka Discovery Mode) where dying and
                deleting the save file during restore can both be overridden.
        z       Zap a wand.  (Use y instead of z if number_pad is -1.)
        Z       Cast a spell.  (Use Y instead of Z if number_pad is -1.)
        ^Z      Suspend the game.  (^Y instead of ^Z if number_pad is -1.)
                [To resume, use the shell command 'fg'.]
        :       Look at what is here.
        ;       Look at what is somewhere else.
        ,       Pick up some things.
        @       Toggle the pickup option.
        ^       Ask for the type of a trap you found earlier.
        )       Tell what weapon you are wielding.
        [       Tell what armor you are wearing.
        =       Tell what rings you are wearing.
        "       Tell what amulet you are wearing.
        (       Tell what tools you are using.
        *       Tell what equipment you are using; combines the preceding five.
        $       Count your gold pieces.
        +       List the spells you know; also rearrange them if desired.
        \\       Show what types of objects have been discovered.
        \`       Show discovered types for one class of objects.
        !       Escape to a shell, if supported in your version and OS.
                [To resume play, terminate the shell subprocess via 'exit'.]
        #       Introduces one of the "extended" commands.  To get a list of
                the commands you can use with "#" type "#?".  The extended
                commands you can use depends upon what options the game was
                compiled with, along with your class and what type of monster
                you most closely resemble at a given moment.  If your keyboard
                has a meta key (which, when pressed in combination with another
                key, modifies it by setting the 'meta' (8th, or 'high') bit),
                these extended commands can be invoked by meta-ing the first
                letter of the command.  An alt key may have a similar effect.

        If the "number_pad" option is on, some additional letter commands
        are available:

        h       displays the help menu, like '?'
        j       Jump to another location.
        k       Kick (for doors, usually).
        l       Loot a box on the floor.
        n       followed by number of times to repeat the next command.
        N       Name a monster, an individual object, or a type of object.
        u       Untrap a trapped object or door.

        You can put a number before a command to repeat it that many times,
        as in "40." or "20s".  If you have the number_pad option set, you
        must type 'n' to prefix the count, as in "n40." or "n20s".


        Some information is displayed on the bottom line or perhaps in a
        box, depending on the platform you are using.  You see your
        attributes, your alignment, what dungeon level you are on, how many
        hit points you have now (and will have when fully recovered), what
        your armor class is (the lower the better), your experience level,
        and the state of your stomach.  Optionally, you may or may not see
        other information such as spell points, how much gold you have, etc.

        Have Fun, and Happy Hacking!
`,kt=`y k u   7 8 9   Move commands:
 \\|/     \\|/            yuhjklbn: go one step in specified direction
h-.-l   4-.-6           YUHJKLBN: go in specified direction until you
 /|\\     /|\\                        hit a wall or run into something
b j n   1 2 3           g<dir>:   run in direction <dir> until something
      numberpad                     interesting is seen
                        G<dir>,   same, except a branching corridor isn't
 <  up                  ^<dir>:     considered interesting (the ^ in this
                                    case means the Control key, not a caret)
 >  down                m<dir>:   move without picking up objects/fighting
                        F<dir>:   fight even if you don't sense a monster
                If the number_pad option is set, the digit keys move instead.
                Depending on the platform, Shift digit (on the numberpad),
                Meta digit, or Alt digit will invoke the YUHJKLBN commands.
                Control <dir> may or may not work when number_pad is enabled,
                depending on the platform's capabilities.
                Digit '5' acts as 'G' prefix, unless number_pad is set to 2
                in which case it acts as 'g' instead.
                If number_pad is set to 3, the roles of 1,2,3 and 7,8,9 are
                reversed; when set to 4, behaves same as 3 combined with 2.
                If number_pad is set to -1, alphabetic movement commands are
                used but 'y' and 'z' are swapped.

General commands:
?     help      display one of several informative texts
#quit quit      end the game without saving current game
S     save      save the game (to be continued later) and exit
                [to restore, play again and use the same character name;
                use #quit to quit without saving]
!     sh        escape to some SHELL (if allowed; 'exit' to resume play)
^Z    suspend   suspend the game (independent of your current suspend char)
                [on UNIX(tm)-based systems, use the 'fg' command to resume]
O     options   set options
/     what-is   tell what a map symbol represents
\\     known     display list of what's been discovered
v     version   display version number
V     history   display game history
^A    again     redo the previous command
^R    redraw    redraw the screen
^P    prevmsg   repeat previous message (consecutive ^P's repeat earlier ones)
#               introduces an extended command (#? for a list of them)
&     what-does describe the command a keystroke invokes

Control characters are depicted as '^' followed by a letter.  Depress Ctrl
or Control like a shift key then type the letter.  Control characters are
case-insensitive; ^D is the same as ^d, Ctrl+d is same as Ctrl+Shift+d.
There are a few non-letter control characters; nethack uses ^[ as a synonym
for Escape (or vice versa) but none of the others.

Game commands:
^D    kick      kick (a door, or something else)
^T    Tport     teleport (if you can)
^X    show      show your attributes
a     apply     apply or use a tool (pick-axe, key, camera, etc.)
A     takeoffall  choose multiple items of armor, accessories, and weapons
                to take off, remove, unwield (uses same amount of game time
                as removing them individually with T,R,w- would take)
c     close     close a door
C     call      name a monster, an individual object, or a type of object
d     drop      drop an object.  d7a:  drop seven items of object 'a'
D     Drop      drop selected types of objects
e     eat       eat something
E     engrave   write a message in the dust on the floor  (E-  use fingers)
f     fire      fire ammunition from quiver
F     fight     followed by direction, fight a monster
i     invent    list your inventory (all objects you are carrying)
I     Invent    list selected parts of your inventory; for example
                  I(  list all tools, or  I"  list all amulets
                  IB  list all items known to be blessed
                  IU  uncursed, or  IC  cursed, or  IX  unknown bless state
                  Iu  when in a shop, list unpaid objects being carried
                  Ix  in a shop, list any fees and used-up shop-owned items
o     open      open a door
p     pay       pay your bill (in a shop)
P     puton     put on an accessory (ring, amulet, etc; can be used to wear
                armor too, but armor items aren't listed as likely candidates)
q     quaff     drink something (potion, water, etc)
Q     quiver    select ammunition for quiver (use '#quit' to quit)
r     read      read a scroll or spellbook
R     remove    remove an accessory (ring, amulet, etc; can be used to take
                off armor too)
s     search    search for secret doors, hidden traps and monsters
t     throw     throw or shoot a weapon
T     takeoff   take off some armor; can be used to remove accessories too,
                but those aren't listed as likely candidates)
w     wield     wield a weapon  (w-  wield nothing to unwield current weapon)
W     wear      wear an item of armor; can be used to put on accessories too,
                but those aren't listed as likely candidates)
x     xchange   swap wielded and secondary weapons
X     twoweapon toggle two-weapon combat if role allows that
z     zap       zap a wand  (use y instead of z if number_pad is -1)
Z     Zap       cast a spell  (use Y instead of Z if number_pad is -1)
<     up        go up the stairs
>     down      go down the stairs
^     trap_id   identify a previously found trap
),[,=,",(       show current items of specified symbol in use
*               show combination of ),[,=,",( all at once
$     gold      count your gold
+     spells    list the spells you know; also rearrange them if desired
\`     classkn   display known items for one class of objects
_     travel    move via a shortest-path algorithm to a point on the map
.     rest      wait a moment
,     pickup    pick up all you can carry
@               toggle "pickup" (auto pickup) option on and off
:     look      look at what is here
;     farlook   look at what is somewhere else by selecting a map location
                (for a monster on top of one or more objects, only describes
                that monster; for a pile of objects, only describes top one)

Keyboards that have a meta key (some use Alt for that, so typing Alt as a
shift plus 'e' would generate 'M-e') can also use these extended commands
via the meta modifier as an alternative to using the # prefix.  Unlike
control characters, meta characters are case-sensitive so M-a is different
from M-A.  Type the latter with two keys used as shifts, Meta+Shift+a.

M-?             display extended command help (if the platform allows this)
M-2   twoweapon toggle two-weapon combat (unless number_pad is enabled)
M-a   adjust    adjust inventory letters
M-A   annotate  add a one-line note to the current dungeon level (see M-O)
M-c   chat      talk to someone
M-C   conduct   view optional challenges
M-d   dip       dip an object into something
M-e   enhance   show weapon and spell skills, can improve them if eligible
M-f   force     force a lock
M-i   invoke    invoke an object's special powers
M-j   jump      jump to another location
M-l   loot      loot a box on the floor
M-m   monster   when polymorphed, use monster's special ability
M-n   name      name a monster, an individual object, or a type of object
M-N   name      synonym for M-n  (both are the same as C)
M-o   offer     offer a sacrifice to the gods
M-O   overview  display information about visited levels and annotations
M-p   pray      pray to the gods for help
M-q   quit      stop playing without saving game (use S to save and exit)
M-r   rub       rub a lamp or a stone
M-R   ride      mount or dismount saddled steed
M-s   sit       sit down
M-t   turn      turn undead if role allows that
M-T   tip       upend a container to dump out its contents
M-u   untrap    untrap something
M-v   version   print compile time options for this version
M-w   wipe      wipe off your face
M-X   explore   switch from regular play to non-scoring explore mode

If the 'number_pad' option is on, keys usually used for movement can be
used for various commands:

n               followed by number of times to repeat the next command
h     help      display one of several informative texts, like '?'
j     jump      jump to another location
k     kick      kick something (usually a door)
l     loot      loot a box on the floor
N     name      name an item or type of object
u     untrap    untrap something (usually a trapped object)

Additional commands are available in debug mode (also known as wizard mode).
`,vt=`NetHack History file for release 3.6

Behold, mortal, the origins of NetHack...

Jay Fenlason wrote the original Hack with help from Kenny Woodland,
Mike Thome, and Jon Payne.

Andries Brouwer did a major re-write, transforming Hack into a very different
game, and published (at least) three versions (1.0.1, 1.0.2, and 1.0.3) for
UNIX(tm) machines to the Usenet.

Don G. Kneller ported Hack 1.0.3 to Microsoft(tm) C and MS-DOS(tm), producing
PC HACK 1.01e, added support for DEC Rainbow graphics in version 1.03g, and
went on to produce at least four more versions (3.0, 3.2, 3.51, and 3.6;
note that these are old Hack version numbers, not contemporary NetHack ones).

R. Black ported PC HACK 3.51 to Lattice(tm) C and the Atari 520/1040ST,
producing ST Hack 1.03.

Mike Stephenson merged these various versions back together, incorporating
many of the added features, and produced NetHack version 1.4 in 1987.  He
then coordinated a cast of thousands in enhancing and debugging NetHack 1.4
and released NetHack versions 2.2 and 2.3.

Later, Mike coordinated a major rewrite of the game, heading a team which
included Ken Arromdee, Jean-Christophe Collet, Steve Creps, Eric Hendrickson,
Izchak Miller, Eric S. Raymond, John Rupley, Mike Threepoint, and Janet Walz,
to produce NetHack 3.0c.  The same group subsequently released ten patch-
level revisions and updates of 3.0.

NetHack 3.0 was ported to the Atari by Eric R. Smith, to OS/2 by Timo
Hakulinen, and to VMS by David Gentzel.  The three of them and Kevin Darcy
later joined the main NetHack Development Team to produce subsequent
revisions of 3.0.

Olaf Seibert ported NetHack 2.3 and 3.0 to the Amiga.  Norm Meluch, Stephen
Spackman and Pierre Martineau designed overlay code for PC NetHack 3.0.
Johnny Lee ported NetHack 3.0 to the Macintosh.  Along with various other
Dungeoneers, they continued to enhance the PC, Macintosh, and Amiga ports
through the later revisions of 3.0.

Headed by Mike Stephenson and coordinated by Izchak Miller and Janet Walz,
the NetHack Development Team which now included Ken Arromdee, David Cohrs,
Jean-Christophe Collet, Kevin Darcy, Matt Day, Timo Hakulinen, Steve Linhart,
Dean Luick, Pat Rankin, Eric Raymond, and Eric Smith undertook a radical
revision of 3.0.  They re-structured the game's design, and re-wrote major
parts of the code.  They added multiple dungeons, a new display, special
individual character quests, a new endgame and many other new features, and
produced NetHack 3.1.

Ken Lorber, Gregg Wonderly and Greg Olson, with help from Richard Addison,
Mike Passaretti, and Olaf Seibert, developed NetHack 3.1 for the Amiga.

Norm Meluch and Kevin Smolkowski, with help from Carl Schelin, Stephen
Spackman, Steve VanDevender, and Paul Winner, ported NetHack 3.1 to the PC.

Jon W{tte and Hao-yang Wang, with help from Ross Brown, Mike Engber, David
Hairston, Michael Hamel, Jonathan Handler, Johnny Lee, Tim Lennan, Rob Menke,
and Andy Swanson developed NetHack 3.1 for the Macintosh, porting it for
MPW.  Building on their development, Bart House added a Think C port.

Timo Hakulinen ported NetHack 3.1 to OS/2.  Eric Smith ported NetHack 3.1
to the Atari.  Pat Rankin, with help from Joshua Delahunty, is responsible
for the VMS version of NetHack 3.1.  Michael Allison ported NetHack 3.1 to
Windows NT.

Dean Luick, with help from David Cohrs, developed NetHack 3.1 for X11.
Warwick Allison wrote a tiled version of NetHack for the Atari;
he later contributed the tiles to the NetHack Development Team and tile
support was then added to other platforms.

The 3.2 NetHack Development Team, comprised of Michael Allison, Ken Arromdee, 
David Cohrs, Jessie Collet, Steve Creps, Kevin Darcy, Timo Hakulinen, Steve
Linhart, Dean Luick, Pat Rankin, Eric Smith, Mike Stephenson, Janet Walz,
and Paul Winner, released version 3.2 in April of 1996.

Version 3.2 marked the tenth anniversary of the formation of the development
team.  In a testament to their dedication to the game, all thirteen members
of the original NetHack Development Team remained on the team at the start of
work on that release.  During the interval between the release of 3.1.3 and
3.2, one of the founding members of the NetHack Development Team, 
Dr. Izchak Miller, passed away.  That release of the game was dedicated to
him by the development and porting teams.

Version 3.2 proved to be more stable than previous versions.  Many bugs
were fixed, abuses eliminated, and game features tuned for better game
play.

During the lifespan of NetHack 3.1 and 3.2, several enthusiasts of the game
added their own modifications to the game and made these "variants" publicly
available:

Tom Proudfoot and Yuval Oren created NetHack++, which was quickly renamed
NetHack--.  Working independently, Stephen White wrote NetHack Plus.
Tom Proudfoot later merged NetHack Plus and his own NetHack-- to produce
SLASH.  Larry Stewart-Zerba and Warwick Allison improved the spellcasting
system with the Wizard Patch.  Warwick Allison also ported NetHack to use
the Qt interface.

Warren Cheung combined SLASH with the Wizard Patch to produce Slash'em, and
with the help of Kevin Hugo, added more features.  Kevin later joined the
NetHack Development Team and incorporated the best of these ideas in 
NetHack 3.3.

The final update to 3.2 was the bug fix release 3.2.3, which was released
simultaneously with 3.3.0 in December 1999 just in time for the Year 2000.

The 3.3 NetHack Development Team, consisting of Michael Allison, Ken Arromdee,
David Cohrs, Jessie Collet, Steve Creps, Kevin Darcy, Timo Hakulinen,
Kevin Hugo, Steve Linhart, Ken Lorber, Dean Luick, Pat Rankin, Eric Smith,
Mike Stephenson, Janet Walz, and Paul Winner, released 3.3.0 in
December 1999 and 3.3.1 in August of 2000.

Version 3.3 offered many firsts.  It was the first version to separate race
and profession.  The Elf class was removed in preference to an elf race,
and the races of dwarves, gnomes, and orcs made their first appearance in
the game alongside the familiar human race.  Monk and Ranger roles joined
Archeologists, Barbarians, Cavemen, Healers, Knights, Priests, Rogues,
Samurai, Tourists, Valkyries and of course, Wizards.  It was also the first
version to allow you to ride a steed, and was the first version to have a
publicly available web-site listing all the bugs that had been discovered.
Despite that constantly growing bug list, 3.3 proved stable enough to last
for more than a year and a half.

The 3.4 NetHack Development Team initially consisted of Michael Allison, 
Ken Arromdee, David Cohrs, Jessie Collet, Kevin Hugo, Ken Lorber, Dean Luick,
Pat Rankin, Mike Stephenson, Janet Walz, and Paul Winner, with Warwick Allison
joining just before the release of NetHack 3.4.0 in March 2002.

As with version 3.3, various people contributed to the game as a whole as
well as supporting ports on the different platforms that NetHack runs on:

Pat Rankin maintained 3.4 for VMS.

Michael Allison maintained NetHack 3.4 for the MS-DOS platform.
Paul Winner and Yitzhak Sapir provided encouragement.

Dean Luick, Mark Modrall, and Kevin Hugo maintained and enhanced the
Macintosh port of 3.4.

Michael Allison, David Cohrs, Alex Kompel, Dion Nicolaas, and Yitzhak Sapir
maintained and enhanced 3.4 for the Microsoft Windows platform.  Alex Kompel
contributed a new graphical interface for the Windows port.  Alex Kompel also
contributed a Windows CE port for 3.4.1.

Ron Van Iwaarden maintained 3.4 for OS/2.

Janne Salmijarvi and Teemu Suikki maintained and enhanced the
Amiga port of 3.4 after Janne Salmijarvi resurrected it for 3.3.1.

Christian \`Marvin' Bressler maintained 3.4 for the Atari after he
resurrected it for 3.3.1.

The release of NetHack 3.4.3 in December 2003 marked the beginning of a
long release hiatus.  3.4.3 proved to be a remarkably stable version that
provided continued enjoyment by the community for more than a decade.  The
NetHack Development Team slowly and quietly continued to work on the game behind the scenes
during the tenure of 3.4.3.  It was during that same period that several
new variants emerged within the NetHack community.  Notably sporkhack by
Derek S. Ray, unnethack by Patric Mueller, nitrohack and its successors
originally by Daniel Thaler and then by Alex Smith, and
Dynahack by Tung Nguyen.  Some of those variants continue to be developed,
maintained, and enjoyed by the community to this day.

In September 2014, an interim snapshot of the code under development was
released publicly by other parties.  Since that code was a work-in-progress
and had not gone through a period of debugging, it was decided that the
version numbers present on that code snapshot would be retired and never
used in an official NetHack release.  An announcement was posted on the
NetHack Development Team's official nethack.org website to that effect, 
stating that there would never be a 3.4.4, 3.5, or 3.5.0 official release
version.

In January 2015, preparation began for the release of NetHack 3.6.

At the beginning of development for what would eventually get released
as 3.6.0, the NetHack Development Team consisted of Warwick Allison,
Michael Allison, Ken Arromdee, David Cohrs, Jessie Collet, Ken Lorber,
Dean Luick, Pat Rankin, Mike Stephenson, Janet Walz, and Paul Winner.
Leading up to the release of 3.6.0 in early 2015, new members Sean Hunt,
Pasi Kallinen, and Derek S. Ray joined the NetHack Development Team.

Near the end of the development of 3.6.0, one of the significant inspirations
for many of the humorous and fun features found in the game, author
Terry Pratchett, passed away.  NetHack 3.6.0 introduced a tribute to him.

3.6.0 was released in December 2015, and merged work done by the development
team since the release of 3.4.3 with some of the beloved community patches.
Many bugs were fixed and some code was restructured.

The NetHack Development Team, as well as Steve VanDevender and 
Kevin Smolkowski ensured that NetHack 3.6 continued to operate on various
Unix flavors as well as maintaining the X11 interface.

Ken Lorber, Haoyang Wang, Pat Rankin, and Dean Luick maintained the port
of NetHack 3.6.1 for Mac OSX.

Michael Allison, David Cohrs, Bart House, Pasi Kallinen, Alex Kompel,
Dion Nicolaas, Derek S. Ray and Yitzhak Sapir maintained the port of
NetHack 3.6 for Microsoft Windows.

Pat Rankin attempted to keep the VMS port running for NetHack 3.6,
hindered by limited access.  Kevin Smolkowski has updated and tested it
for the most recent version of OpenVMS (V8.4 as of this writing) on Alpha
and Integrity (aka Itanium aka IA64) but not VAX.

Ray Chason resurrected the msdos port for 3.6 and contributed the
necessary updates to the community at large.

In late April 2018, several hundred bug fixes for 3.6.0 and some new
features were assembled and released as NetHack 3.6.1.
The NetHack Development Team at the time of release of 3.6.1 consisted of
Warwick Allison, Michael Allison, Ken Arromdee, David Cohrs, Jessie Collet,
Pasi Kallinen, Ken Lorber, Dean Luick, Patric Mueller, Pat Rankin,
Derek S. Ray, Alex Smith, Mike Stephenson, Janet Walz and Paul Winner.

In early May 2019, another 320 bug fixes along with some enhancements and 
the adopted curses window port, were released as 3.6.2.

Bart House, who had contributed to the game as a porting team participant 
for decades, joined the NetHack Development Team in late May 2019.

NetHack 3.6.3 was released on December 5, 2019 containing over 190 bug
fixes to NetHack 3.6.2.

NetHack 3.6.4 was released on December 18, 2019 containing a security
fix and a few bug fixes.

NetHack 3.6.5 was released on January 27, 2020 containing some security fixes
and a small number of bug fixes.

NetHack 3.6.6 was released on March 8, 2020 containing a security fix and 
some bug fixes.

NetHack 3.6.7 was released in February 2023 containing a security fix and
some bug fixes.

The official NetHack web site is maintained by Ken Lorber at
http://www.nethack.org/.

On behalf of the NetHack community, thank you very much once again  to
M.  Drew  Streib and Pasi Kallinen for providing a public NetHack server
at nethack.alt.org. Thanks to  Keith  Simpson  and Andy Thomson for
hardfought.org. Thanks to all those unnamed dungeoneers who invest their
time and  effort  into  annual  NetHack tournaments  such as Junethack
and in days past, devnull.net (gone for now, but not forgotten).

                           - - - - - - - - - -

From time to time, some depraved individual out there in netland sends a
particularly intriguing modification to help out with the game.  The
NetHack Development Team sometimes makes note of the names of the worst
of these miscreants in this, the list of Dungeoneers:

    Adam Aronow               J. Ali Harlow             Mikko Juola
    Alex Kompel               Janet Walz                Nathan Eady
    Alex Smith                Janne Salmijarvi          Norm Meluch
    Andreas Dorn              Jean-Christophe Collet    Olaf Seibert
    Andy Church               Jeff Bailey               Pasi Kallinen
    Andy Swanson              Jochen Erwied             Pat Rankin
    Andy Thomson              John Kallen               Patric Mueller
    Ari Huttunen              John Rupley               Paul Winner
    Bart House                John S. Bien              Pierre Martineau
    Benson I. Margulies       Johnny Lee                Ralf Brown
    Bill Dyer                 Jon W{tte                 Ray Chason
    Boudewijn Waijers         Jonathan Handler          Richard Addison
    Bruce Cox                 Joshua Delahunty          Richard Beigel
    Bruce Holloway            Karl Garrison             Richard P. Hughey
    Bruce Mewborne            Keizo Yamamoto            Rob Menke
    Carl Schelin              Keith Simpson             Robin Bandy
    Chris Russo               Ken Arnold                Robin Johnson
    David Cohrs               Ken Arromdee              Roderick Schertler
    David Damerell            Ken Lorber                Roland McGrath
    David Gentzel             Ken Washikita             Ron Van Iwaarden
    David Hairston            Kevin Darcy               Ronnen Miller
    Dean Luick                Kevin Hugo                Ross Brown
    Del Lamb                  Kevin Sitze               Sascha Wostmann
    Derek S. Ray              Kevin Smolkowski          Scott Bigham
    Deron Meranda             Kevin Sweet               Scott R. Turner
    Dion Nicolaas             Lars Huttar               Sean Hunt
    Dylan O'Donnell           Leon Arnott               Stephen Spackman
    Eric Backus               M. Drew Streib            Stefan Thielscher
    Eric Hendrickson          Malcolm Ryan              Stephen White
    Eric R. Smith             Mark Gooderum             Steve Creps
    Eric S. Raymond           Mark Modrall              Steve Linhart
    Erik Andersen             Marvin Bressler           Steve VanDevender
    Fredrik Ljungdahl         Matthew Day               Teemu Suikki
    Frederick Roeber          Merlyn LeRoy              Tim Lennan
    Gil Neiger                Michael Allison           Timo Hakulinen
    Greg Laskin               Michael Feir              Tom Almy
    Greg Olson                Michael Hamel             Tom West
    Gregg Wonderly            Michael Sokolov           Warren Cheung
    Hao-yang Wang             Mike Engber               Warwick Allison
    Helge Hafting             Mike Gallop               Yitzhak Sapir
    Irina Rempt-Drijfhout     Mike Passaretti           
    Izchak Miller             Mike Stephenson           
`,xt=`	Depending upon hardware or operating system or NetHack's interface,
	some keystrokes may be off-limits.

	For example, ^S and ^Q are often used for XON/XOFF flow-control,
	meaning that ^S suspends output and subsequent ^Q resumes suspended
	output.  When that is the case, neither of those characters will
	reach NetHack when it is waiting for a command keystroke.  So they
	aren't used as commands, but 'whatdoes' might not be able to tell
	you that if they don't get passed through to NetHack.

	^M or <return> or <enter> is likely to be transformed into ^J or
	<linefeed> or 'newline' before being passed to NetHack for handling.
	So it isn't used as a command, and 'whatdoes' might seem as if it
	is reporting the wrong character but will be operating correctly if
	it describes ^J when you type ^M.

	A NUL character, which is typed as ^<space> on some keyboards,
	^@ on others, and maybe not typeable at all on yet others, is not
	used as a command, and will be converted into ESC before reaching
	'whatdoes'.  Unlike ^M, this transformation is performed within
	NetHack.  But like ^M, if you type NUL and get feedback about ESC,
	the situation is expected.

	ESC itself is a synonym for ^[, and is another source of oddity.
	Various function keys, including cursor arrow keys, may transmit
	an "escape sequence" of ESC + [ + other stuff, confusing NetHack
	as to what command was intended since the ESC will be processed
	and then whatever follows will seem to NetHack like--and be used
	as--something typed by the user.  (If you press a function key and
	a menu of the armor your hero is wearing appears, what happened
	was that an escape sequence was sent to NetHack, its ESC aborted
	any pending key operation, its '[' was then treated as a command
	to show worn armor, and the "other stuff" probably got silently
	discarded as invalid choices while you dismissed the menu.)

	If you have NetHack's 'altmeta' option enabled, meaning that the
	<alt> or <option> key, when used as shift while typing some other
	character, transmits ESC and then the other character so NetHack
	should treat that other character as a meta-character, then ESC
	takes on added potential for confusion.  Implicit in the handling
	of a two character sequence ESC + something is the fact that when
	NetHack sees ESC, it needs to wait for another character before
	it can decide what to do.  So if you type ESC manually, you'll
	need to type it a second time or NetHack will sit there waiting.
	(It will then be treated as if you typed ESC rather than M-ESC.)

	On some systems, typing ^\\ will send a QUIT signal to the current
	process, probably killing it and possibly causing it to save a
	core dump.  It is not used for any NetHack command, so don't type
	that character.

	One last note:  characters shown as ^x mean that you should hold
	down the <control> or <ctrl> key as a shift and then type 'x'.
	Control characters are all implicitly uppercase, but you don't
	need to press the shift key while typing them.  The opposite is
	true for meta-characters:  they can be either case, so you need
	to use shift as well as <meta> or <alt> to generate an uppercase
	letter meta-character.
`,Mt=`                    NETHACK GENERAL PUBLIC LICENSE
                    (Copyright 1989 M. Stephenson)

               (Based on the BISON general public license,
                   copyright 1988 Richard M. Stallman)

 Everyone is permitted to copy and distribute verbatim copies of this
 license, but changing it is not allowed.  You can also use this wording to
 make the terms for other programs.

  The license agreements of most software companies keep you at the mercy of
those companies.  By contrast, our general public license is intended to give
everyone the right to share NetHack.  To make sure that you get the rights we
want you to have, we need to make restrictions that forbid anyone to deny you
these rights or to ask you to surrender the rights.  Hence this license
agreement.

  Specifically, we want to make sure that you have the right to give away
copies of NetHack, that you receive source code or else can get it if you
want it, that you can change NetHack or use pieces of it in new free
programs, and that you know you can do these things.

  To make sure that everyone has such rights, we have to forbid you to
deprive anyone else of these rights.  For example, if you distribute copies
of NetHack, you must give the recipients all the rights that you have.  You
must make sure that they, too, receive or can get the source code.  And you
must tell them their rights.

  Also, for our own protection, we must make certain that everyone finds out
that there is no warranty for NetHack.  If NetHack is modified by someone
else and passed on, we want its recipients to know that what they have is
not what we distributed.

  Therefore we (Mike Stephenson and other holders of NetHack copyrights) make
the following terms which say what you must do to be allowed to distribute or
change NetHack.


                        COPYING POLICIES

  1. You may copy and distribute verbatim copies of NetHack source code as
you receive it, in any medium, provided that you keep intact the notices on
all files that refer to copyrights, to this License Agreement, and to the
absence of any warranty; and give any other recipients of the NetHack
program a copy of this License Agreement along with the program.

  2. You may modify your copy or copies of NetHack or any portion of it, and
copy and distribute such modifications under the terms of Paragraph 1 above
(including distributing this License Agreement), provided that you also do the
following:

    a) cause the modified files to carry prominent notices stating that you
    changed the files and the date of any change; and

    b) cause the whole of any work that you distribute or publish, that in
    whole or in part contains or is a derivative of NetHack or any part
    thereof, to be licensed at no charge to all third parties on terms
    identical to those contained in this License Agreement (except that you
    may choose to grant more extensive warranty protection to some or all
    third parties, at your option)

    c) You may charge a distribution fee for the physical act of
    transferring a copy, and you may at your option offer warranty protection
    in exchange for a fee.

  3. You may copy and distribute NetHack (or a portion or derivative of it,
under Paragraph 2) in object code or executable form under the terms of
Paragraphs 1 and 2 above provided that you also do one of the following:

    a) accompany it with the complete machine-readable source code, which
    must be distributed under the terms of Paragraphs 1 and 2 above; or,

    b) accompany it with full information as to how to obtain the complete
    machine-readable source code from an appropriate archive site.  (This
    alternative is allowed only for noncommercial distribution.)

For these purposes, complete source code means either the full source
distribution as originally released over Usenet or updated copies of the
files in this distribution used to create the object code or executable.

  4. You may not copy, sublicense, distribute or transfer NetHack except as
expressly provided under this License Agreement.  Any attempt otherwise to
copy, sublicense, distribute or transfer NetHack is void and your rights to
use the program under this License agreement shall be automatically
terminated.  However, parties who have received computer software programs
from you with this License Agreement will not have their licenses terminated
so long as such parties remain in full compliance.


Stated plainly:  You are permitted to modify NetHack, or otherwise use parts
of NetHack, provided that you comply with the conditions specified above;
in particular, your modified NetHack or program containing parts of NetHack
must remain freely available as provided in this License Agreement.  In
other words, go ahead and share NetHack, but don't try to stop anyone else
from sharing it farther.
`,St=`Boolean options not under specific compile flags (with default values in []):
(You can learn which options exist in your version by checking your current
option setting, which is reached via the 'O' command.)

acoustics      can your character hear anything                   [TRUE]
autodescribe   describe the terrain under cursor                  [FALSE]
autodig        dig if moving and wielding digging tool            [FALSE]
autoopen       walking into a door attempts to open it            [TRUE]
autopickup     automatically pick up objects you move over        [TRUE]
autoquiver     when firing with an empty quiver, select some      [FALSE]
               suitable inventory weapon to fill the quiver
BIOS           allow the use of IBM ROM BIOS calls                [FALSE]
blind          your character is permanently blind                [FALSE]
bones          allow loading bones files                          [TRUE]
clicklook      look at map by clicking right mouse button         [FALSE]
cmdassist      give help for errors on direction & other commands [TRUE]
confirm        ask before hitting tame or peaceful monsters       [TRUE]
dark_room      show floor not in sight in different color         [TRUE]
eight_bit_tty  send 8-bit characters straight to terminal         [FALSE]
extmenu        tty, curses: use menu for # (extended commands)    [FALSE]
               X11: menu has all commands (T) or traditional subset (F)
fixinv         try to retain the same letter for the same object  [TRUE]
force_invmenu  commands asking for inventory item show a menu     [FALSE]
goldX          when filtering objects by bless/curse state,       [FALSE]
               whether to classify gold as X (unknown) or U (uncursed)
help           print all available info when using the / command  [TRUE]
herecmd_menu   show menu of some possible commands when clicking
               on yourself or next to you with mouse              [FALSE]
ignintr        ignore interrupt signal, including breaks          [FALSE]
implicit_uncursed  omit "uncursed" from inventory, if possible    [TRUE]
legacy         print introductory message                         [TRUE]
lit_corridor   show a dark corridor as lit if in sight            [FALSE]
lootabc        use a/b/c rather than o/i/b when looting           [FALSE]
mail           enable the mail daemon                             [TRUE]
mention_walls  give feedback when walking against a wall          [FALSE]
menu_objsyms   show object symbols in menus if it is selectable   [FALSE]
menu_overlay   overlay menus on the screen and align to right     [TRUE]
nudist         start your character without armor                 [FALSE]
null           allow nulls to be sent to your terminal            [TRUE]
               try turning this option off (forcing NetHack to use its own
               delay code) if moving objects seem to teleport across rooms
perm_invent    keep inventory in a permanent window               [FALSE]
pickup_thrown  override pickup_types for thrown objects           [TRUE]
pushweapon     when wielding a new weapon, put your previously    [FALSE]
               wielded weapon into the secondary weapon slot
rawio          allow the use of raw I/O                           [FALSE]
rest_on_space  count the space bar as a rest character            [FALSE]
safe_pet       prevent you from (knowingly) attacking your pet(s) [TRUE]
sanity_check   perform data sanity checks                         [FALSE]
showexp        display your accumulated experience points         [FALSE]
showrace       show yourself by your race rather than by role     [FALSE]
silent         don't use your terminal's bell sound               [TRUE]
sortpack       group similar kinds of objects in inventory        [TRUE]
sparkle        display sparkly effect for resisted magical        [TRUE]
               attacks (e.g. fire attack on fire-resistant monster)
standout       use standout mode for --More-- on messages         [FALSE]
status_updates update the status lines                            [TRUE]
time           display elapsed game time, in moves                [FALSE]
tombstone      print tombstone when you die                       [TRUE]
toptenwin      print topten in a window rather than stdout        [FALSE]
travel         enable the command to travel to a map location via [TRUE]
               a shortest-path algorithm, usually invoked by '_'.
use_darkgray   use bold black instead of blue for black glyphs.   [TRUE]
use_inverse    display detected monsters in highlighted manner    [FALSE]
verbose        print more commentary during the game              [TRUE]
whatis_menu    show menu when getting a map location              [FALSE]
whatis_moveskip skip same glyphs when getting a map location      [FALSE]


There are further boolean options controlled by compilation flags.

Boolean option if INSURANCE was set at compile time:
checkpoint     save game state after each level change, for       [TRUE]
               possible recovery after program crash

Boolean option if NEWS was set at compile time:
news           print any news from game administrator on startup  [TRUE]

Boolean option if MFLOPPY was set at compile time:
checkspace     check free disk space before writing files to disk [TRUE]

Boolean option if SCORE_ON_BOTL was set at compile time:
showscore      display your approximate accumulated score         [FALSE]

Boolean options if TEXTCOLOR was set at compile time:
color          use different colors for objects on screen [TRUE for micros]
hilite_pet     display pets in a highlighted manner               [FALSE]
hilite_pile    display item piles in a highlighted manner         [FALSE]

Boolean option if TIMED_DELAY was set at compile time (tty interface only):
timed_delay    on unix and VMS, use a timer instead of sending    [TRUE]
               extra screen output when attempting to pause for
               display effect.  on MSDOS without the termcap
               lib, whether or not to pause for visual effect.

Boolean option for Amiga, or for others if ALTMETA was set at compile time:
altmeta        For Amiga, treat Alt+key as Meta+key.              [TRUE]
altmeta        For unix and VMS, treat two character sequence
               "ESC c" as M-c (Meta+c, 8th bit set) when nethack  [FALSE]
               obtains a command from player's keyboard.

Boolean option if USE_TILES was set at compile time (MSDOS protected mode):
preload_tiles  control whether tiles get pre-loaded into RAM at   [TRUE]
               the start of the game.  Doing so enhances performance
               of the tile graphics, but uses more memory.

Boolean option if TTY_TILES_ESCCODES was set at compile time (tty only):
vt_tiledata    insert extra data escape code markers into output  [FALSE]

Any Boolean option can be negated by prefixing it with a '!' or 'no'.


Compound options are written as option_name:option_value.

Compound options which can be set during the game are:

boulder       override the default boulder symbol                       [\`]
disclose      the types of information you want         [ni na nv ng nc no]
              offered at the end of the game
              (space separated list of two-character values;
              prefix: '+' always disclose, '-' never disclose,
              'n' prompt with default "no", 'y' prompt with default "yes",
              'a' prompt to select sorting order (for suffix 'v' only);
              suffix: 'i' inventory, 'a' attributes, 'v' vanquished
              monsters, 'g' genocided and extinct monsters, 'c' conduct,
              'o' dungeon overview)
fruit         the name of a fruit you enjoy eating             [slime mold]
              (basically a whimsy which NetHack uses from time to time).
menustyle     user interface for selection of multiple objects:      [Full]
              Traditional -- prompt for classes of interest, then
                             prompt item-by-item for those classes;
              Combination -- prompt for classes of interest, then
                             use a menu for choosing items;
              Full        -- menu for classes of interest, then item menu;
              Partial     -- skip class filtering, use menu of all items;
              only the first letter ('T','C','F','P') matters
              (With Traditional, many actions allow pseudo-class 'm' to
              request a menu for choosing items: one-shot Combination.)
number_pad    alphabetic versus numeric control over movement:          [0]
               0 -- traditional hjkl + yubn movement (default);
               1 -- digits control movement, for use with numeric keypad;
               2 -- same as 1, but '5' works as 'g' prefix rather than 'G';
               3 -- numeric for phone keypad (1,2,3 above, 7,8,9 below);
               4 -- phone keypad (3) combined with '5' preference (2);
              -1 -- alphabetic movement but 'z' swapped with 'y'.
              Setting number_pad (to a positive value) affects how all
              digit keys are handled, not just those on numeric keypad.
packorder     a list of default symbols for kinds of       [")[%?+!=/(*\`0_]
              objects that gives the order in which your inventory (and
              some other things) gets shown if the 'sortpack' option is on
              (If you specify only some kinds of items, the others from the
              default order will be appended to the end.)
paranoid_confirmation  space separated list    [paranoid_confirmation:pray]
              of situations where alternate prompting is desired
              Confirm -- when requiring "yes", also require "no" to reject
              quit    -- yes vs y to confirm quitting or to enter explore mode
              die     -- yes vs y to confirm dying (for explore or debug mode)
              bones   -- yes vs y to confirm saving bones data in debug mode
              attack  -- yes vs y to confirm attacking a peaceful monster
              wand-break  -- yes vs y to confirm breaking a wand
              eating  -- yes vs y to confirm whether to continue eating
              Were-change -- yes vs y to confirm changing form due to
                      lycanthropy when hero has polymorph control;
              pray    -- y to confirm an attempt to pray; on by default
              Remove  -- always pick from inventory for 'R' and 'T' even when
                      wearing just one applicable item to remove or take off
pickup_burden when you pick up an item that exceeds this encumbrance    [S]
              level (Unencumbered, Burdened, streSsed, straiNed, overTaxed,
              or overLoaded), you will be asked if you want to continue.
pickup_types  a list of default symbols for kinds of objects to          []
              autopickup when that option is on; empty list means "all"
pile_limit    for feedback when walking across floor objects,           [5]
              threshold at which "there are objects here" is displayed
              instead of listing them.  (0 means "always list objects.")
runmode       controls how often the map window is updated for        [run]
              multi-step movement (various running modes or travel command):
              teleport -- don't update map until movement stops;
              run      -- periodically update map (interval is seven steps);
              walk     -- update map after every step;
              crawl    -- like walk, but delay after making each step.
              (This only affects screen display, not actual movement.)
scores        the parts of the score list you wish    [!own/3 top/2 around]
              to see when the game ends.  You choose a combination of
              top scores, scores around the top scores, and all of your
              own scores.
suppress_alert disable various version-specific warnings about changes   []
              in game play or the user interface, such as notification given
              for the 'Q' command that quitting is now done via #quit
              (e.g., use suppress_alert:3.3.1 to stop that and any other
              notifications added in that version or earlier)
whatis_coord  controls whether to include map coordinates when          [n]
              autodescribe is active for the '/' and ';' commands.
              Value is the first letter of one of
              compass      -- (relative to you; 'east' or '3s' or '2n,4w')
              full compass -- ('east' or '3south' or '2north,4west')
              map          -- <x,y>        (map column x=0 is not used)
              screen       -- [row,column] (row is offset to match tty usage)
              none         -- no coordinates shown.
whatis_filter controls how to filter eligible map coordinates when      [n]
              getting a map location for eg. the travel command.
              Value is the one of
              n - no filtering
              v - locations in view only
              a - locations in same area (room, corridor, etc)

Compound options which may be set only on startup are:

align      Your starting alignment (lawful, neutral, chaotic,      [random]
           or random).  Many roles restrict the choice to a subset.
           You may specify just the first letter.
catname    the name of your first cat                                [none]
dogname    the name of your first dog                                [none]
           Several roles who start with a dog have one whose name is
           pre-set (for example, "Hachi" for Samurai), but that name
           will be overridden if you specify dogname.
gender     Your starting gender (male, female, or random).         [random]
           You may specify just the first letter.  Although you can
           still denote your gender using the old "male" and "female"
           boolean options, the "gender" option will take precedence.
horsename  the name of your first horse                              [none]
menu_*     specify single character accelerators for menu commands.
           Here is a list of all commands with their default keystroke
           followed by a list of window-ports that implement them:
           'x' is X11, 't' is tty, 'g' is Gem, 'a' is Amiga.
           menu_deselect_all  deselect all items in a menu         [-](xtga)
           menu_deselect_page deselect all items on this menu page [\\](tga)
           menu_first_page    jump to the first page in a menu     [^](tga)
           menu_invert_all    invert all items in a menu           [@](xtga)
           menu_invert_page   invert all items on this menu page   [~](tga)
           menu_last_page     jump to the last page in a menu      [|](tga)
           menu_next_page     goto the next menu page              [>](tga)
           menu_previous_page goto the previous menu page          [<](tga)
           menu_search        search for a menu item               [:](xtga)
           menu_select_all    select all items in a menu           [.](xtga)
           menu_select_page   select all items on this menu page   [,](tga)
msghistory number of top line messages to save                         [20]
name       the name of your character      [defaults to username on multi-
           user systems, asks "who are you?" on single-user systems or if
           the username is classified as generic like "games"]
           MS Windows is treated as single-user even though it supports
           usernames.  If character name is specified on the command
           line (typically via 'nethack -u myname' depending upon type
           of system and method of access to it), that name overrides
           'name' from your options.
pettype    your preferred type of pet (cat, dog, horse, random,    [random]
           or none), if your role allows more than one type (or if you
           want to avoid a starting pet).  Most roles allow dog or cat
           but not horse.  For roles which force a particular type,
           pettype is ignored unless it specifies 'none'.
playmode   normal play or non-scoring explore mode or debug mode   [normal]
race       Your starting race (e.g., race:Human, race:Elf).        [random]
           Most roles restrict race choice to a subset.
role       Your starting role (e.g., role:Barbarian, role:Valk).   [random]
           Although you can specify just the first letter(s), it will
           choose only the first role it finds that matches; thus, it
           is recommended that you spell out as much of the role name
           as possible.  You can also still denote your role by
           appending it to the "name" option (e.g., name:Vic-V), but
           the "role" option will take precedence.
windowtype windowing system to be used    [depends on operating system and
           compile-time setup]    if more than one choice is available.
           Most instances of the program support only one window-type;
           when that is the case, you don't need to specify anything.
           The list of supported window-types in your program can be
           seen while the program is running by using the #version
           command or from outside the program by examining the text file
           named 'options' which is generated when building it.

Compound option if TTY_GRAPHICS was set at compile time:
msg_window the type of message window to use:                      [single]
           single      -- One message at a time
           full        -- Full window with all saved top line messages
           reverse     -- Same as full, but messages printed most-recent-first
           combination -- Two single messages, then as full


Some sample options lists are:
!autopickup,!tombstone,name:Gandalf,scores:own/3 top/2 around
female,nonews,dogname:Rover,rest_on_space,!verbose,menustyle:traditional
`,It=`Debug-Mode Quick Reference:

^E  ==  detect secret doors and traps
^F  ==  map level; reveals traps and secret corridors but not secret doors
^G  ==  create monster by name or class
^I  ==  identify items in pack
^T  ==  do intra-level teleport
^V  ==  do trans-level teleport; '?' yields menu of special destinations
^W  ==  make a wish for an item or a trap or a limited subset of terrain
^X  ==  show status, attributes, and characteristics (extended enlightenment)

#levelchange    == set hero's experience level
#lightsources   == show mobile light sources
#panic          == panic test (warning: current game will be terminated)
#polyself       == polymorph self
#seenv          == show seen vectors
#stats          == show memory statistics
#terrain        == show current level (more options than in normal play)
#timeout        == look at timeout queue and hero's timed intrinsics
#vanquished     == disclose counts of dead monsters sorted in various ways
#vision         == show vision array
#wizintrinsic   == set selected intrinsic timeouts
#wizmakemap     == recreate the current dungeon level
#wizrumorcheck  == validate first and last rumor for true and false set
#wizsmell       == smell a monster
#wizwhere       == show dungeon placement of all special levels
#wmode          == show wall modes

Options:
monpolycontrol  == prompt for new form whenever any monster changes shape
sanity_check    == evaluate monsters, objects, and map prior to each turn
wizweight       == augment object descriptions with their objects' weight
`,Ct=`        Microsoft Windows specific help file for NetHack 3.6
        Copyright (c) NetHack PC Development Team 1993-2002.
        NetHack may be freely distributed.  See license for details.
                   (Last Revision: March 16, 2003)

This file details specifics for NetHack built for Windows 95, 98, NT, 
Me, 2000, and XP. Users of really early 16-bit Windows versions should 
use the MSDOS NetHack. 

Please note that "NetHack for Windows - Graphical Interface" requires 
an installation of Internet Explorer 4 or an installation of 
version 4.71 of the common controls. See the following internet page: 
    http://www.nethack.org/v340/ports/download-win.html#cc
for more information. If the game runs for you, you are not affected.

New players should be sure to read GuideBook.txt which contains 
essential information about playing NetHack. It can be found in the
same directory as your NetHack executable.

The NetHack for Windows port supports some additional or enhanced 
commands as well as some defaults.nh file options specific to 
configuration choices used during the building of NetHack for 
Windows. Listed below are those commands and defaults.nh file 
options. 

Some options are applicable only to the "Graphical Interface." 
These are discussed separately in their own section. 

Contents
1. ALT Key Combinations
2. Boolean options - Option that you can toggle on or off
3. Graphical Interface - Options you can assign a value to
4. Graphical Interface - Additional/Enhanced Commands
5. Graphical Interface - Menus
6. Numeric Keypad (for number_pad mode)


1. ALT Key Combinations
----------------------------------------------
The non-graphical (tty) interface always operates in "NetHack mode",
while the "NetHack for Windows - Graphical Interface" lets you
toggle the mode.  In non-NetHack mode, all ALT-key combinations
are sent to the Windows itself, rather than to NetHack.

While playing in NetHack mode you can press the ALT key in 
combination with another key to execute an extended command
as an alternative method to pressing a # key sequence.
The available commands are:

    Alt-2    #twoweapon      - toggle two-weapon combat (unavailable
                               if number_pad mode is set)
    Alt-a    #adjust         - adjust inventory letters.
    Alt-c    #chat           - talk to someone or something.
    Alt-d    #dip            - dip an object into something.
    Alt-e    #enhance        - enhance your skill with a weapon.
    Alt-f    #force          - force a lock.
    Alt-i    #invoke         - invoke an object's powers.
    Alt-j    #jump           - jump to a location.
    Alt-l    #loot           - loot a box on the floor.
    Alt-m    #monster        - use a monster's special ability. 
    Alt-n    #name           - name an item or type of object.
    Alt-o    #offer          - offer a sacrifice to the gods.
    Alt-p    #pray           - pray to the gods for help.
    Alt-q    #quit           - quit the game. (Same as #quit)
    Alt-r    #rub            - rub a lamp.
    Alt-s    #sit            - sit down.
    Alt-t    #turn           - turn undead.
    Alt-u    #untrap         - untrap something.
    Alt-v    #version        - list compile time options for this version of
                               NetHack.
    Alt-w    #wipe           - wipe off your face.
    Alt-?    #?              - display list of extended menu commands

2. Boolean Options (Options that can be toggled on or off)
----------------------------------------------------------

Listed here are any options not discussed in the main help, options 
which may be slightly different from the main help file, and options 
which may need a slightly more explanatory note: 

    color          Use color when displaying non-tiled maps. Tiled 
                   maps (available in the graphical port) are always 
                   rendered in color. Default: [TRUE]

    hilite_pet     Using tiled graphics, displays a small heart symbol
                   next to your pet.  Using ascii graphics, the pet is
                   hilited in a white background.
                   Default: [TRUE]

    IBMgraphics    Use IBM extended characters for the dungeon 
                   Default: [TRUE] 
 
    msg_window     When ^P is pressed, it shows menu in a full window.
                   Available only in the non-graphical (tty) version.
                   Default: [FALSE] 

    toptenwin      Write top ten list to a window, as opposed to stdout.
                   Default in tty interface: [FALSE]
		   Default in graphical interface: [TRUE] (and cannot be changed)

3. Options that you assign a value to (Graphical Interface only)
----------------------------------------------------------------

"NetHack for Windows - Graphical Interface" recognizes the following 
additional options, which the non-graphical (tty) version will
silently ignore.  These are options that specify attributes of various
windows.  The windows that you can tailor include menu windows (such 
as the inventory list), text windows (such as "It is written in the 
book of ..." screens), the message window (where events of the game are
displayed), the status window (where your character name
and attributes are displayed), and the map window (where the map
is drawn).

Window Alignment options:

    align_message  Specifies at which side of the NetHack screen the 
                   message window is aligned. This option can be used 
                   to align the window to "top" or "bottom".
                   Default: [TOP] 

    align_status   Specifies at which side of the NetHack screen the 
                   status window is aligned. This option can be used
                   to align the window to "top" or "bottom".
                   Default: [BOTTOM] 

Map Window options:

    map_mode       Specifies which map mode to use. 
                   The following map modes are available: 
                   tiles (display things on the map with colored tiles), 
                   ascii4x6, ascii6x8, ascii8x8, ascii16x8, ascii7x12,
                   ascii8x12, ascii16x12, ascii12x16, ascii10x18
                   (which use that size font to display things on 
                   the map), or fit_to_screen (an ascii mode which
                   forces things to fit on a single screen).
                   Default: [tiles]

    scroll_margin  Specifies the number of map cells from the edge
                   of the map window where scrolling will take place.
                   Default: [5] 

    tile_file      An alternative file containing bitmap to use for 
                   tiles. This file should be a .bmp file and should 
                   be organized as 40 rectangular tiles wide. It is 
                   beyond the scope of this document to describe the 
                   exact contents of each tile in the .bmp, which must
                   match the object lists used when building NetHack.

    tile_height    Used with tile_file to specify the height of each 
                   tile in pixels. This option may only be specified
                   in the defaults.nh config file.
                   Default: [16] 

    tile_width     Used with tile_file to specify the width of each 
                   tile in pixels. This option may only be specified
                   in the defaults.nh config file. 
                   Default: [16]

Other Window options:

    windowcolors   Specifies the colors for various windows
                   This option may only be specified in the
                   defaults.nh config file and has the following
                   format:
                       window-type foreground/background
                   Notes:
                      - Both foreground and background colors are
                        required, and a slash must separate them.
                      - "window-type" is either "message" or "status"
                        (Short forms are: "msg" or "sts").
                      - "foreground" and "background" may be specified as
                        a color name (such as "blue"), or by a six
                        digit hexadecimal RGB color value (such as
                        "#8F8F8F")
                      - The following color names are available:
                        black, red, green, brown, blue, magenta,
                        cyan, gray (or grey), orange, brightgreen,
                        yellow, brightblue, brightmagenta, brightcyan,
                        white, trueblack, purple, silver, maroon, fuchsia,
                        lime, olive, navy, teal, aqua. In addition, you 
                        can use the following names to refer to default 
                        Windows settings: activeborder, activecaption, 
                        appworkspace, background, btnface, btnshadow, btntext, 
                        captiontext, graytext, highlight, highlighttext, 
                        inactiveborder, inactivecaption, menu, menutext, 
                        scrollbar, window, windowframe, windowtext.

                        Example:
                        OPTIONS=windowcolors:sts #00FF80/blue msg menutext/menu

    font_menu      Specifies the name of the menu font.
    font_message   Specifies the name of the message font.
    font_status    Specifies the name of the status font.
    font_text      Specifies the name of the text font.

    font_size_menu Specifies the size of the menu font.

    font_size_message
                   Specifies the size of the message font.

    font_size_status
                   Specifies the size of the status font.

    font_size_text Specifies the size of the text font.

Miscellaneous options: 

    vary_msgcount  Number of lines to display in message window. 


4. NetHack for Windows - Graphical Interface, Additional/Enhanced Commands
-------------------------------------------------------------------------

The following function keys are active in
the "NetHack for Windows - Graphical Interface": 

    F4             Toggle level overview mode on/off 
                   This key will toggle the map between a view that 
                   is mapped to fit exactly to the window, and the 
                   view that shows the various symbols in their 
                   normal size. This is useful for getting an idea 
                   of where you are in a level. 

    F5             Toggle tiled display on/off. 
                   This key switches between the tiled and the 
                   traditional ASCII display. This is equivalent to 
                   using the "map_mode" option. 

    F10            Activate menu bar. 
                   This key will activate the menu bar, allowing you 
                   to select between the menus: File, Map, 
                   Window Settings, and Help. 

5. Graphical Port Menus
-----------------------

File
  Save - Allows you to save and exit the game
  Quit - Allows you to quit the game

Map - Provides for selection of map mode. Equivalent to using 
the map_mode option. 

Window Settings - Changes your logged-on user's settings for NetHack.
In 3.5.0, only one setting is available: NetHack mode, which can be
checked or unchecked. NetHack mode allows you to use the ALT key for
game key commands [see list above]. You can use F10 to access the
menu bar while in NetHack mode. You can also clear your logged-on
user's settings for NetHack. Settings in this window are saved in
your logged-on user's registry. 

Help - Provides help about various portions of NetHack.


6. Numeric Keypad (for "OPTION=number_pad" mode)
------------------------------------------------

The numeric keypad and surrounding characters act as macros for different
commands in NetHack.  The Num Lock should be toggled to "on" to make the
most of these keys:

          Key         Normal       Shift-Key
       ----------   ----------    -------------
       1, 2, 3, 4   Move In       Run In
       6, 7, 8, 9   Direction     Direction

        0 (Ins)     Inventory     Categorized
                                  Inventory

        . (Del)     Wait Turn     : - Look Here

        +           Spell List    P - Put on an
                                  accessory

        -           m - Move      Previous
                    Only          Message

    NetHack for Windows - tty Interface Specific Behavior:
    ------------------------------------------------------

      In the non-graphical (tty) interface, when you use the Ctrl key with a
      directional key (1, 2, 3, 4, 6, 7, 8, 9) it means "go in specified
      direction until you hit a wall or run into something interesting."

    NetHack for Windows - Graphical Interface Specific Behavior:
    ------------------------------------------------------------

      It is possible to scroll or pan the map in a specific direction:

        Ctrl-Shift-Left  (4)     Scroll (Pan) map left
        Ctrl-Shift-Right (6)     Scroll (Pan) map right
        Ctrl-Shift-Up    (8)     Scroll (Pan) map up
        Ctrl-Shift-Down  (2)     Scroll (Pan) map down
        Ctrl-Shift-Home  (7)     Scroll (Pan) map left to leftmost corner
        Ctrl-Shift-End   (1)     Scroll (Pan) map left to rightmost corner
        Ctrl-Shift-PgUp  (9)     Scroll (Pan) map left to uppermost corner
        Ctrl-Shift-PgDn  (3)     Scroll (Pan) map left to lowermost corner



`;const _t={cmdhelp:{title:"Command Help",text:wt},help:{title:"NetHack Help",text:bt},hh:{title:"NetHack Help",text:kt},history:{title:"NetHack History",text:vt},keyhelp:{title:"Key Help",text:xt},license:{title:"NetHack License",text:Mt},opthelp:{title:"Option Help",text:St},wizhelp:{title:"Wizard Help",text:It},porthelp:{title:"Port Help",text:Ct}},Tt={shelp:"cmdhelp",help:"help",history:"history",keyhelp:"keyhelp",optionfile:"opthelp",wizhelp:"wizhelp",license:"license",port_help:"porthelp"};function Nt(l){return(typeof l=="string"?l:String(l??"")).trim().toLowerCase()}function At(l){const t=String(l||"").replace(/\r\n/g,`
`).replace(/\r/g,`
`).replace(/\f/g,`

`).split(`
`).map(n=>n.trimEnd());for(;t.length>0&&t[t.length-1]==="";)t.pop();return t}function Et(l){const e=Nt(l);if(!e)return null;const t=Tt[e]||e,n=_t[t];return n?{canonicalName:t,title:n.title,lines:At(n.text)}:null}const Pt=[{key:"playmode",label:"Play Mode",description:"Choose startup mode. Wizard mode is NetHack debug mode (`playmode:debug`).",control:"select",defaultValue:"normal",options:[{value:"normal",label:"Normal"},{value:"explore",label:"Explore"},{value:"debug",label:"Wizard/Debug"}]},{key:"autopickup",label:"Autopickup",description:"Automatically pick up item classes selected in pickup types.",control:"boolean",defaultValue:!0},{key:"pickup_types",label:"Pickup Types",description:'Object class symbols to autopickup (example: $"=/!?+). Leave blank for game default.',control:"text",defaultValue:"$",serializeWhenDefault:!0,maxLength:20,placeholder:'$"=/!?+'},{key:"pickup_thrown",label:"Pickup Thrown Items",description:"Automatically pick up thrown items when they land.",control:"boolean",defaultValue:!0},{key:"pickup_burden",label:"Pickup Burden Threshold",description:"Prompt before pickup when this encumbrance level would be exceeded.",control:"select",defaultValue:"n",options:[{value:"u",label:"Unencumbered (u)"},{value:"b",label:"Burdened (b)"},{value:"s",label:"Stressed (s)"},{value:"n",label:"Strained (n)"},{value:"t",label:"Overtaxed (t)"},{value:"l",label:"Overloaded (l)"}]},{key:"pile_limit",label:"Pile Limit",description:"Item count threshold that triggers a popup list for floor piles.",control:"number",defaultValue:5,min:0,max:50,step:1},{key:"autoquiver",label:"Autoquiver",description:"Auto-fill quiver or ready a suitable weapon when firing.",control:"boolean",defaultValue:!1},{key:"autoopen",label:"Autoopen",description:"Automatically try to open doors while moving into them.",control:"boolean",defaultValue:!0},{key:"autodig",label:"Autodig",description:"Automatically dig into walls when able and moving into them.",control:"boolean",defaultValue:!1},{key:"cmdassist",label:"Command Assist",description:"Show extra help text when commands are mistyped.",control:"boolean",defaultValue:!0},{key:"confirm",label:"Confirm Attacks",description:"Ask before attacking peaceful creatures.",control:"boolean",defaultValue:!0},{key:"safe_pet",label:"Safe Pet",description:"Ask before hitting your pet.",control:"boolean",defaultValue:!0},{key:"help",label:"In-Game Help",description:"Prompt to show extra look/help details when more information exists.",control:"boolean",defaultValue:!0},{key:"legacy",label:"Legacy Intro",description:"Show the story intro when a new game begins.",control:"boolean",defaultValue:!0},{key:"rest_on_space",label:"Rest On Space",description:"Treat space key as wait/rest.",control:"boolean",defaultValue:!1},{key:"pushweapon",label:"Push Weapon",description:"Move currently wielded weapon to offhand when swapping.",control:"boolean",defaultValue:!1},{key:"extmenu",label:"Extended Command Menu",description:"Use a menu popup for extended commands.",control:"boolean",defaultValue:!1},{key:"fixinv",label:"Fix Inventory Letters",description:"Try to preserve inventory letters as items move.",control:"boolean",defaultValue:!0},{key:"implicit_uncursed",label:"Show Uncursed",description:"Always include the word 'uncursed' in inventory descriptions.",control:"boolean",defaultValue:!0},{key:"mention_walls",label:"Mention Walls",description:"Show a message when moving against a wall.",control:"boolean",defaultValue:!1},{key:"sortloot",label:"Sort Loot Lists",description:"Sorting behavior for pickup and inventory selection lists.",control:"select",defaultValue:"l",options:[{value:"f",label:"Full"},{value:"l",label:"Loot-only"},{value:"n",label:"None"}]},{key:"sortpack",label:"Sort Inventory",description:"Sort pack contents by type when showing inventory.",control:"boolean",defaultValue:!0},{key:"msghistory",label:"Message History Size",description:"Number of top-line messages retained for recall.",control:"number",defaultValue:20,min:20,max:500,step:1},{key:"dogname",label:"Dog Name",description:"Default name for your first dog.",control:"text",defaultValue:"",maxLength:30,placeholder:"Fido"},{key:"catname",label:"Cat Name",description:"Default name for your first cat.",control:"text",defaultValue:"",maxLength:30,placeholder:"Morris"},{key:"horsename",label:"Horse Name",description:"Default name for your first horse.",control:"text",defaultValue:"",maxLength:30,placeholder:"Silver"},{key:"pettype",label:"Preferred Pet",description:"Preferred initial pet type for roles that can vary.",control:"select",defaultValue:"",options:[{value:"",label:"Game default"},{value:"cat",label:"Cat"},{value:"dog",label:"Dog"},{value:"horse",label:"Horse"},{value:"none",label:"None"}]},{key:"fruit",label:"Preferred Fruit",description:"Name of the fruit type your character enjoys.",control:"text",defaultValue:"",maxLength:31,placeholder:"slime mold"},{key:"packorder",label:"Pack Order",description:"Order of item classes shown in inventory.",control:"text",defaultValue:"",maxLength:20,placeholder:'")[%?+/=!(*0_`'},{key:"paranoid_confirmation",label:"Paranoid Confirmation",description:"Space-separated extra confirmations (example: confirm quit attack pray).",control:"text",defaultValue:"",maxLength:64,placeholder:"confirm quit attack pray"},{key:"sparkle",label:"Magic Resistance Sparkle",description:"Show special sparkle effects for magic resistance.",control:"boolean",defaultValue:!0},{key:"standout",label:"Standout Monsters/More",description:"Bold monsters and --More-- prompts.",control:"boolean",defaultValue:!1},{key:"tombstone",label:"Tombstone",description:"Show tombstone graphic at death.",control:"boolean",defaultValue:!0},{key:"verbose",label:"Verbose Messages",description:"Use fuller status and action message wording.",control:"boolean",defaultValue:!0}],Lt=new Map(Pt.map(l=>[l.key.toLowerCase(),l])),Ht=new Map([["getpos.autodescribe","nothing"]]);function Je(l,e,t){return Math.min(t,Math.max(e,l))}function Rt(l){const e=String(l),t=e.indexOf(".");return t<0?0:Math.max(0,e.length-t-1)}function Dt(l,e){const t=typeof e=="number"&&Number.isFinite(e)?e:Number(e);if(!Number.isFinite(t))return l.defaultValue;const n=Je(t,l.min,l.max),o=Math.max(1e-6,l.step),s=Math.round((n-l.min)/o),i=l.min+s*o,a=Rt(o);return Number(Je(i,l.min,l.max).toFixed(a))}function Ft(l,e){return typeof l!="string"?"":l.replace(/[\u0000-\u001f\u007f]/g," ").replace(/,/g," ").replace(/\s+/g," ").trim().slice(0,Math.max(0,e))}function $t(l,e){if(typeof e!="string")return l.defaultValue;const t=e.trim().toLowerCase(),n=l.options.find(o=>o.value.toLowerCase()===t);return n?n.value:l.defaultValue}function Bt(l,e){switch(l.control){case"boolean":return typeof e=="boolean"?e:l.defaultValue;case"select":return $t(l,e);case"text":return Ft(e,l.maxLength);case"number":return Dt(l,e);default:return""}}function qt(l){const e=l.startsWith("!")?l.slice(1):l,t=e.indexOf(":");return t<0?e.toLowerCase():e.slice(0,t).toLowerCase()}function Gt(l,e){const t=Ht.get(l);return!t||String(e||"").trim().toLowerCase()!==t?null:`${l}:${t}`}function Ot(l){if(typeof l!="string")return null;const e=l.trim();if(!e||e.includes(","))return null;const t=e.startsWith("!"),n=t?e.slice(1).trim():e;if(!n)return null;const o=n.indexOf(":"),s=(o<0?n:n.slice(0,o)).trim().toLowerCase(),i=Lt.get(s);if(!i){if(t||o<0)return null;const u=n.slice(o+1);return Gt(s,u)}if(i.control==="boolean")return o>=0?null:t?`!${i.key}`:i.key;if(t||o<0)return null;const a=n.slice(o+1),r=Bt(i,a),c=String(r??"").trim();return c?`${i.key}:${c}`:null}function Xe(l){if(!Array.isArray(l)||l.length===0)return[];const e=new Map;for(const t of l){const n=Ot(t);n&&e.set(qt(n),n)}return Array.from(e.values())}const Wt={0:"BL_TITLE",1:"BL_STR",2:"BL_DX",3:"BL_CO",4:"BL_IN",5:"BL_WI",6:"BL_CH",7:"BL_ALIGN",8:"BL_SCORE",9:"BL_CAP",10:"BL_GOLD",11:"BL_ENE",12:"BL_ENEMAX",13:"BL_XP",14:"BL_AC",15:"BL_HD",16:"BL_TIME",17:"BL_HUNGER",18:"BL_HP",19:"BL_HPMAX",20:"BL_LEVELDESC",21:"BL_EXP",22:"BL_CONDITION"},zt={0:"BL_TITLE",1:"BL_STR",2:"BL_DX",3:"BL_CO",4:"BL_IN",5:"BL_WI",6:"BL_CH",7:"BL_ALIGN",8:"BL_SCORE",9:"BL_HP",10:"BL_HPMAX",11:"BL_ENE",12:"BL_ENEMAX",13:"BL_AC",14:"BL_XP",15:"BL_EXP",16:"BL_TIME",17:"BL_HUNGER",18:"BL_CAP",19:"BL_DNUM",20:"BL_DLEVEL",21:"BL_GOLD",22:"BL_CONDITION",23:"BL_FLUSH",24:"BL_RESET",25:"BL_CHARACTERISTICS"},Ut={},jt=typeof globalThis<"u"&&globalThis.process?globalThis.process:{env:{}};class Vt{constructor(e,t=null){var n;this.runtimeVersion="3.6.7",this.eventHandler=e,this.startupOptions=t&&typeof t=="object"?t:{},this.isClosed=!1,this.nethackInstance=null,this.gameMap=new Map,this.playerPosition={x:0,y:0},this.gameMessages=[],this.lastPromptContextMessage="",this.recentUICallbackHistory=[],this.latestInventoryItems=[],this.latestStatusUpdates=new Map,this.currentMenuItems=[],this.currentWindow=null,this.currentMenuQuestionText="",this.hasShownCharacterSelection=!1,this.lastQuestionText=null,this.menuSelections=new Map,this.isInMultiPickup=!1,this.pendingMenuSelection=null,this.menuSelectionReadyCount=null,this.lastEndedMenuWindow=null,this.lastEndedMenuHadQuestion=!1,this.lastEndedInventoryMenuKind=null,this.lastMenuInteractionCancelled=!1,this.windowTextBuffers=new Map,this.messageHistorySnapshot=[],this.messageHistorySnapshotIndex=0,this.pendingGameOverPossessionsInventoryFlow=!1,this.inputBroker=new De,this.farLookMode="none",this.farLookOrigin=null,this.pendingLookMenuFarLookArm=!1,this.pendingTextResponses=[],this.positionInputActive=!1,this.positionCursor=null,this.activeInputRequest=null,this.awaitingQuestionInput=!1,this.numberPadModeEnabled=!0,this.metaInputPrefix="__META__:",this.ctrlInputPrefix="__CTRL__:",this.menuSelectionInputPrefix="__MENU_SELECT__:",this.textInputPrefix="__TEXT_INPUT__:",this.inventoryContextSelectionPrefix="__INVCTX_SELECT__:",this.inventoryContextSelectionCountPrefix="__INVCTX_SELECT_COUNT__:",this.contextualGlanceProbePrefix="__CTX_GLANCE_PROBE__",this.contextualGlanceProbeMouseDeadlineMs=0,this.contextualGlanceAutoCancelPositionUntilMs=0,this.contextualGlanceAutoCancelPositionWindowMs=450,this.pendingInventoryContextSelection=null,this.pendingTextRequest=null,this.textInputMaxLength=256,this.mouseInputTokenKey="__MOUSE_INPUT__",this.mouseClickPrimaryMod=1,this.mouseClickSecondaryMod=2,this.extendedCommandEntries=null,this.pendingExtendedCommand=null,this.extendedCommandTriggerQueued=!1,this.pendingExtendedCommandRequest=null,this.startupExtmenuEnabled=this.resolveStartupExtmenuEnabled((n=this.startupOptions)==null?void 0:n.initOptions),this.statusPending=new Map,this.nameRequestDebugCounter=0,this.nameInitDebugCounter=0,this.travelSpeedDelayMs=60,this.travelClickMoveBlockExtraMs=5,this.clickMoveBlockedUntilMs=0,this.didLogMissingLevelIdentityGlobals=!1,this.ready=this.initializeNetHack()}normalizeRuntimeVersion(e){return e==="3.7"?"3.7":"3.6.7"}getRuntimeStatusFieldMap(){return this.runtimeVersion==="3.7"?zt:Wt}seedRuntimeStatusFieldConstants(){const e=globalThis.nethackGlobal&&globalThis.nethackGlobal.constants&&typeof globalThis.nethackGlobal.constants=="object"?globalThis.nethackGlobal.constants:null;if(!e)return;const n={...e.STATUS_FIELD&&typeof e.STATUS_FIELD=="object"?e.STATUS_FIELD:{}},o=this.getRuntimeStatusFieldMap();for(const[s,i]of Object.entries(o||{})){const a=Number(s);if(!Number.isFinite(a))continue;const r=String(i??"").trim();r&&(n[a]=r,n[r]===void 0&&(n[r]=a))}n[-1]="BL_FLUSH",n[-2]="BL_RESET",n[-3]="BL_CHARACTERISTICS",n.BL_FLUSH===void 0&&(n.BL_FLUSH=-1),n.BL_RESET===void 0&&(n.BL_RESET=-2),n.BL_CHARACTERISTICS===void 0&&(n.BL_CHARACTERISTICS=-3),e.STATUS_FIELD=n}unpackGlyphArgs(e){const[t,n,o,s,i]=e;if(this.runtimeVersion!=="3.7")return{win:t,x:n,y:o,glyph:s,mgflags:0,extra:i};let a=s,r=0;return a>65535&&(r=a>>>16&65535,a=a&65535),{win:t,x:n,y:o,glyph:a,mgflags:r,extra:i}}async loadRuntimeFactory(e){if(e==="3.7"){const{default:n}=await import("./index-dvm-_ctL.js");return n}const{default:t}=await import("./index-CR-DPCKC.js");return t}normalizeCharacterOptionValue(e){if(typeof e!="string")return"";const t=e.trim();return t||""}normalizeCharacterNameValue(e){if(typeof e!="string")return"";const t=e.replace(/,/g," ").replace(/\s+/g," ").trim();return t?t.slice(0,30):""}setRuntimePlayerName(e){const t=this.normalizeCharacterNameValue(e);if(!t)return!1;const n=globalThis.nethackGlobal&&globalThis.nethackGlobal.globals&&typeof globalThis.nethackGlobal.globals=="object"?globalThis.nethackGlobal.globals:null;if(!n)return!1;try{if(Object.prototype.hasOwnProperty.call(n,"plname"))return n.plname=t,!0;if(n.g&&typeof n.g=="object"&&Object.prototype.hasOwnProperty.call(n.g,"plname"))return n.g.plname=t,!0}catch(o){console.log("Failed to write runtime player name:",o)}return!1}buildCharacterCreationRuntimeOptions(){const e=this.startupOptions&&this.startupOptions.characterCreation&&typeof this.startupOptions.characterCreation=="object"?this.startupOptions.characterCreation:null;if(!e)return[];const t=this.normalizeCharacterNameValue(e.name);if(e.mode==="resume")return t?[`name:${t}`]:[];const n=this.normalizeCharacterOptionValue(e.role),o=this.normalizeCharacterOptionValue(e.race),s=this.normalizeCharacterOptionValue(e.gender),i=this.normalizeCharacterOptionValue(e.align);if(e.mode==="random"){const r=[n?`role:${n}`:"role:random",o?`race:${o}`:"race:random",s?`gender:${s}`:"gender:random",i?`align:${i}`:"align:random"];return t&&r.push(`name:${t}`),r}const a=[];return n&&a.push(`role:${n}`),o&&a.push(`race:${o}`),s&&a.push(`gender:${s}`),i&&a.push(`align:${i}`),t&&a.push(`name:${t}`),a}buildStartupInitRuntimeOptions(){var e;return Xe((e=this.startupOptions)==null?void 0:e.initOptions)}resolveStartupExtmenuEnabled(e){return Xe(e).includes("extmenu")}sendReconnectSnapshot(){if(!this.eventHandler)return;this.emit({type:"clear_scene"}),this.emitExtendedCommands("snapshot");const e=Array.from(this.gameMap.values()),t=500;for(let o=0;o<e.length;o+=t)this.emit({type:"map_glyph_batch",tiles:e.slice(o,o+t)});this.emit({type:"player_position",x:this.playerPosition.x,y:this.playerPosition.y});for(const o of this.latestStatusUpdates.values())this.emit(o);this.emit({type:"inventory_update",items:this.latestInventoryItems.map(o=>({...o})),window:4});const n=this.gameMessages.slice(-30);for(const o of n)this.emit({type:"text",text:o.text,window:o.window,attr:o.attr})}async start(){await this.ready,this.emitStartupObjectTileMap(),this.sendReconnectSnapshot(),this.requestRuntimeGlobalsSnapshot()}emitStartupObjectTileMap(){const e=this.buildObjectTileIndexByObjectIdSnapshot();Array.isArray(e)&&this.emit({type:"runtime_object_tile_map",objectTileIndexByObjectId:e})}sendInput(e){this.handleClientInput(e)}sendInputSequence(e){this.handleClientInputSequence(e)}sendMouseInput(e,t,n){this.handleClientMouseInput(e,t,n)}requestTileUpdate(e,t){this.handleTileUpdateRequest(e,t)}requestAreaUpdate(e,t,n){this.handleAreaUpdateRequest(e,t,n)}requestRuntimeGlobalsSnapshot(){this.emit({type:"runtime_globals_snapshot",snapshot:this.buildRuntimeGlobalsSnapshot()})}shutdown(e="session shutdown"){if(!this.isClosed){if(this.isClosed=!0,console.log(`Shutting down NetHack session: ${e}`),this.inputBroker.drain(),this.pendingTextResponses=[],this.farLookMode="none",this.farLookOrigin=null,this.pendingLookMenuFarLookArm=!1,this.setPositionInputActive(!1),this.activeInputRequest=null,this.menuSelections.clear(),this.pendingExtendedCommand=null,this.extendedCommandTriggerQueued=!1,this.resolvePendingExtendedCommandRequest(-1),this.pendingInventoryContextSelection=null,this.awaitingQuestionInput=!1,this.windowTextBuffers.clear(),this.lastMenuInteractionCancelled=!1,this.pendingMenuSelection&&this.pendingMenuSelection.resolver){const t=this.pendingMenuSelection.resolver;this.pendingMenuSelection=null,this.menuSelectionReadyCount=null;try{t(0)}catch(n){console.log("Menu selection resolver shutdown error:",n)}}this.inputBroker.cancelAll(27)}}queueMapGlyphUpdate(e){this.isClosed||!e||!this.eventHandler||this.emit(e)}handleClientInputSequence(e){if(this.isClosed||!Array.isArray(e)||e.length===0)return;const t=e.filter(o=>typeof o=="string"&&o.length>0);if(t.length===0)return;console.log("Received client input sequence:",t);const n=this.extractExtendedCommandSubmission(t);if(n!==null){if(this.resolvePendingExtendedCommandRequestFromText(n))return;this.queueExtendedCommandSubmission(n,"synthetic");return}for(const o of t)this.handleClientInput(o,"synthetic")}handleClientMouseInput(e,t,n,o="user"){if(this.isClosed)return;const s=Math.trunc(Number(e)),i=Math.trunc(Number(t)),a=Math.trunc(Number(n));if(!Number.isFinite(s)||!Number.isFinite(i))return;const r=this.resolveMouseClickMod(a);if(r!==null){if(a===0&&this.isClickMoveBlocked()){console.log(`Discarding click-move during travel overlap window: button=${a} tile=(${s}, ${i})`);return}console.log(`Received client mouse input: button=${a} tile=(${s}, ${i}) mod=${r}`),this.pendingExtendedCommandRequest&&(console.log("Cancelling pending extended-command request due mouse input"),this.resolvePendingExtendedCommandRequest(-1)),this.pendingMenuSelection&&this.isInMultiPickup&&(console.log("Cancelling pending multi-pickup selection due mouse input"),this.resolveMenuSelection(-1)),this.pendingTextRequest&&(console.log("Cancelling pending text request due mouse input"),this.handleTextInputResponse("\x1B","system")),o==="user"&&this.hasPendingInventoryContextSelection()&&this.clearPendingInventoryContextSelection("new user mouse input"),this.enqueueMouseInput(s,i,r,o)}}handleClientInput(e,t="user"){var s,i;if(this.isClosed||typeof e!="string"||e.length===0)return;if(e===this.contextualGlanceProbePrefix){this.contextualGlanceProbeMouseDeadlineMs=Date.now()+1200,this.contextualGlanceAutoCancelPositionUntilMs=0;return}if(console.log("Received client input:",e,{source:t,awaitingQuestionInput:this.awaitingQuestionInput,pendingTextResponses:this.pendingTextResponses.length,activeInputRequestType:((s=this.activeInputRequest)==null?void 0:s.kind)||null,pendingExtendedCommandRequest:!!this.pendingExtendedCommandRequest,pendingMenuSelection:!!this.pendingMenuSelection,isInMultiPickup:this.isInMultiPickup,hasPendingTextRequest:!!this.pendingTextRequest}),((i=this.activeInputRequest)==null?void 0:i.kind)==="position"&&!this.isPositionRequestContinuationInput(e)&&(console.log(`Cancelling active position request before command input "${e}"`),this.enqueueInputKeys(["Escape"],"system",["position"])),t==="user"&&this.hasPendingInventoryContextSelection()&&!this.isAnyInventoryContextSelectionInput(e)&&this.clearPendingInventoryContextSelection("new user input"),this.pendingMenuSelection&&this.isInMultiPickup&&this.isDirectionalMovementInput(e)&&!this.awaitingQuestionInput&&(console.log(`Cancelling pending multi-pickup selection due directional input "${e}"`),this.resolveMenuSelection(-1)),this.pendingTextRequest&&this.isDirectionalMovementInput(e)&&(console.log(`Cancelling pending text request due directional input "${e}"`),this.handleTextInputResponse("\x1B","system")),this.tryConsumePendingExtendedCommandInput(e))return;if(this.isTextInputCommand(e)){const a=e.slice(this.textInputPrefix.length);this.handleTextInputResponse(a,t);return}if(this.armInventoryContextSelectionFromInput(e))return;if(this.isMetaInput(e)){const a=e.slice(this.metaInputPrefix.length).charAt(0);if(!a)return;const r=this.resolveMetaBoundExtendedCommandName(a);if(r){console.log(`Meta input Alt+${a.toLowerCase()} mapped to extended command "${r}"`),this.queueExtendedCommandSubmission(r,"meta");return}this.enqueueInputKeys(["Escape",a],"meta",["event"]);return}if(this.isCtrlInput(e)){const a=e.slice(this.ctrlInputPrefix.length).charAt(0);if(!a)return;const r=a.charCodeAt(0)&31;if(r<=0)return;this.enqueueInputKeys([String.fromCharCode(r)],"ctrl");return}const n=this.resolveMenuItemFromSelectionInput(e);if(n){const a=this.createSelectionEntryFromMenuItem(n);if(!a)return;const r=this.getMenuSelectionKey(a);if(this.isInMultiPickup){this.menuSelections.has(r)?(this.menuSelections.delete(r),console.log(`Deselected item: ${a.menuChar} (${a.text}). Current selections:`,Array.from(this.menuSelections.values()).map(c=>`${c.menuChar}:${c.text}`))):(this.menuSelections.set(r,a),console.log(`Selected item: ${a.menuChar} (${a.text}). Current selections:`,Array.from(this.menuSelections.values()).map(c=>`${c.menuChar}:${c.text}`)));return}if(this.menuSelections.clear(),this.menuSelections.set(r,a),this.lastMenuInteractionCancelled=!1,console.log(`Recorded single menu selection by index: ${a.menuIndex} (${a.menuChar} ${a.text})`),this.awaitingQuestionInput){const c=this.getMenuSelectionWakeInput(n);this.enqueueInputKeys([c],t,["event"])}return}if(this.isLiteralTextInput(e)){this.handleTextInputResponse(e,t);return}const o=this.normalizeInputKey(e);if(!this.isInMultiPickup&&o==="Escape"&&this.awaitingQuestionInput&&Array.isArray(this.currentMenuItems)&&this.currentMenuItems.some(a=>a&&!a.isCategory)&&(this.lastMenuInteractionCancelled=!0,this.clearPendingInventoryContextSelection("menu interaction cancelled")),this.pendingGameOverPossessionsInventoryFlow&&this.isGameOverPossessionsIdentifyQuestion(this.lastQuestionText)&&String(o||"").trim().toLowerCase()!=="y"&&(this.pendingGameOverPossessionsInventoryFlow=!1),!this.isInMultiPickup&&this.awaitingQuestionInput&&typeof o=="string"&&o.length===1&&Array.isArray(this.currentMenuItems)&&this.currentMenuItems.length>0){const a=this.currentMenuItems.find(r=>r.accelerator===o&&!r.isCategory);if(a){this.menuSelections.clear();const r=this.createSelectionEntryFromMenuItem(a);if(!r)return;const c=this.getMenuSelectionKey(r);if(this.menuSelections.set(c,r),this.lastMenuInteractionCancelled=!1,console.log(`Recorded single menu selection: ${o} (${a.text})`),this.isLookAtMapMenuSelection(a)){this.enqueueInputKeys([";"],t,["event"]);return}}}if(this.isInMultiPickup&&typeof o=="string"&&o.length===1&&o!=="\r"&&o!==`
`&&o!=="Escape"){const a=this.currentMenuItems.find(r=>r.accelerator===o&&!r.isCategory);if(a){const r=this.createSelectionEntryFromMenuItem(a);if(!r)return;const c=this.getMenuSelectionKey(r);this.menuSelections.has(c)?(this.menuSelections.delete(c),console.log(`Deselected item: ${o} (${a.text}). Current selections:`,Array.from(this.menuSelections.values()).map(u=>`${u.menuChar}:${u.text}`))):(this.menuSelections.set(c,r),console.log(`Selected item: ${o} (${a.text}). Current selections:`,Array.from(this.menuSelections.values()).map(u=>`${u.menuChar}:${u.text}`)))}else console.log(`No menu item found for accelerator '${o}'`);console.log("Multi-pickup item selection updated");return}if(this.isInMultiPickup&&(o==="Enter"||o==="\r"||o===`
`)){const a=Array.from(this.menuSelections.values()).map(r=>`${r.menuChar}:${r.text}`);console.log("Confirming multi-pickup with selections:",a),this.lastMenuInteractionCancelled=!1,this.resolveMenuSelection(this.menuSelections.size),this.inputBroker.hasPendingRequests("event")&&this.enqueueInputKeys(["Enter"],t,["event"]);return}if(this.isInMultiPickup&&o==="Escape"){this.menuSelections.clear(),this.resolveMenuSelection(-1),this.clearPendingInventoryContextSelection("multi-select menu interaction cancelled"),this.inputBroker.hasPendingRequests("event")&&this.enqueueInputKeys(["Escape"],t,["event"]);return}this.enqueueInputKeys([o],t)}enqueueInputKeys(e,t="user",n="any"){const o=Date.now(),s=[];for(const i of e)typeof i!="string"||i.length===0||s.push({key:i,source:t,createdAt:o,targetKinds:n});s.length>0&&this.inputBroker.enqueueTokens(s)}resolveMouseClickMod(e){return e===0?this.mouseClickPrimaryMod:e===2?this.mouseClickSecondaryMod:null}getClickMoveBlockDurationMs(){const e=Number(this.travelSpeedDelayMs);return!Number.isFinite(e)||e<0?this.travelClickMoveBlockExtraMs:e+this.travelClickMoveBlockExtraMs}beginClickMoveBlockWindow(){this.clickMoveBlockedUntilMs=Date.now()+this.getClickMoveBlockDurationMs()}isClickMoveBlocked(){return Date.now()<this.clickMoveBlockedUntilMs}enqueueMouseInput(e,t,n,o="user"){this.inputBroker.enqueueTokens([{key:this.mouseInputTokenKey,source:o,createdAt:Date.now(),targetKinds:["position"],mouseX:e,mouseY:t,mouseMod:n}])}resolvePoskeyTargetPointer(e,t){if(!this.nethackModule||typeof this.nethackModule.getValue!="function"||!Number.isInteger(e)||e<=0)return console.log(`Skipping nh_poskey ${t} pointer resolve (ptr=${e}): invalid pointer`),null;const n=this.nethackModule.HEAPU8&&this.nethackModule.HEAPU8.length?this.nethackModule.HEAPU8.length:0,o=this.nethackModule.getValue(e,"*"),i=Number.isInteger(o)&&o>1024&&(!n||o+4<=n)?o:e,a=!n||i+4<=n;return!Number.isInteger(i)||i<=0||!a?(console.log(`Skipping nh_poskey ${t} pointer resolve (slot=${e}, target=${i}, heapSize=${n})`),null):i}resolveTextInputBufferPointer(e){if(!this.nethackModule||!this.nethackModule.HEAPU8||typeof this.nethackModule.getValue!="function"||!Number.isInteger(e)||e<=0)return null;const t=this.nethackModule.HEAPU8.length;if(e>0&&e+1<=t)return e;const o=this.nethackModule.getValue(e,"*");return Number.isInteger(o)&&o>0&&o+1<=t?o:null}getPoskeyCoordStoreType(e,t){if(!Number.isInteger(e)||!Number.isInteger(t))return"i32";const n=Math.abs(t-e);return n===1?"i8":n===2?"i16":"i32"}writePoskeyTargetValue(e,t,n,o="i32"){return!this.nethackModule||typeof this.nethackModule.setValue!="function"||!Number.isInteger(e)||e<=0?(console.log(`Skipping nh_poskey ${n} write (target=${e}, value=${t})`),!1):(this.nethackModule.setValue(e,t,o),!0)}applyMouseTokenToPoskeyRequest(e,t){if(!e)return!1;const n=Math.trunc(Number(e.mouseX)),o=Math.trunc(Number(e.mouseY)),s=Math.trunc(Number(e.mouseMod));if(!Number.isFinite(n)||!Number.isFinite(o)||!Number.isFinite(s)||!t)return!1;const i=this.resolvePoskeyTargetPointer(t.xPtr,"x"),a=this.resolvePoskeyTargetPointer(t.yPtr,"y"),r=this.resolvePoskeyTargetPointer(t.modPtr,"mod");if(!i||!a||!r)return!1;const c=this.getPoskeyCoordStoreType(i,a);return this.writePoskeyTargetValue(i,n,"x",c),this.writePoskeyTargetValue(a,o,"y",c),this.writePoskeyTargetValue(r,s,"mod","i32"),console.log(`Delivered mouse input to nh_poskey: (${n}, ${o}) mod=${s} (xPtr=${i}, yPtr=${a}, modPtr=${r}, coordType=${c})`),!0}normalizeInputKey(e){return e==="\r"||e===`
`?"Enter":e}isLikelyNameInputForDebug(e){const t=String(e||"").trim();return t.length<2||t.length>30||t.startsWith("__")||t.includes(":")?!1:/^[A-Za-z][A-Za-z0-9 _'-]*$/.test(t)}isExtendedCommandSubmitToken(e){return e==="Enter"||e==="\r"||e===`
`}extractExtendedCommandSubmission(e){if(!Array.isArray(e)||e.length<2)return null;const t=e[0],n=e[e.length-1];if(t!=="#"||!this.isExtendedCommandSubmitToken(n))return null;let o="";for(let s=1;s<e.length-1;s+=1){const i=e[s];if(i==="Backspace"){o=o.slice(0,-1);continue}if(i!=="#"){if(typeof i=="string"&&i.length===1&&/^[A-Za-z0-9_?-]$/.test(i)){o+=i.toLowerCase();continue}return null}}return o}queueExtendedCommandSubmission(e,t="synthetic"){const n=typeof e=="string"?e:"";this.resolvePendingExtendedCommandRequestFromText(n)||(this.pendingExtendedCommand=n,!this.extendedCommandTriggerQueued&&(this.extendedCommandTriggerQueued=!0,this.enqueueInputKeys(["#"],t)))}dequeuePendingExtendedCommandSubmission(){const e=this.pendingExtendedCommand;if(this.pendingExtendedCommand=null,this.extendedCommandTriggerQueued=!1,e!=null)return e}buildExtendedCommandPromptMenuItems(){const e=this.getExtendedCommandEntries(),t=[];let n=0;for(const o of e){const s=String((o==null?void 0:o.name)||"").trim().toLowerCase();!s||s==="#"||s==="?"||(t.push({menuIndex:n,commandIndex:o.index,accelerator:"",text:s,isCategory:!1}),n+=1)}return t}requestExtendedCommandSelectionFromUi(){if(this.pendingExtendedCommandRequest&&this.pendingExtendedCommandRequest.promise)return this.pendingExtendedCommandRequest.promise;const e=this.buildExtendedCommandPromptMenuItems();if(!e.length||!this.eventHandler)return Promise.resolve(-1);const t=new Map;for(const s of e)Number.isInteger(s.menuIndex)&&Number.isInteger(s.commandIndex)&&t.set(s.menuIndex,s.commandIndex);let n=null;const o=new Promise(s=>{n=s});return this.pendingExtendedCommandRequest={resolve:n,promise:o,commandBuffer:"",menuIndexToCommandIndex:t},this.emit({type:"question",text:"What extended command?",choices:"",default:"",menuItems:e,source:"shim_get_ext_cmd"}),o}resolvePendingExtendedCommandRequest(e){const t=this.pendingExtendedCommandRequest;this.pendingExtendedCommandRequest=null,!(!t||typeof t.resolve!="function")&&t.resolve(Number.isInteger(e)?e:-1)}resolvePendingExtendedCommandRequestFromText(e){if(!this.pendingExtendedCommandRequest)return!1;const t=String(e||"").trim().toLowerCase();if(!t)return this.resolvePendingExtendedCommandRequest(-1),this.clearPendingInventoryContextSelection("extended command submission cancelled"),!0;const n=this.resolveExtendedCommandIndex(t);return n<0?(console.log(`Unknown extended command "${t}" while awaiting shim_get_ext_cmd; canceling`),this.resolvePendingExtendedCommandRequest(-1),this.clearPendingInventoryContextSelection("unknown extended command submission"),!0):(this.resolvePendingExtendedCommandRequest(n),!0)}tryConsumePendingExtendedCommandInput(e){const t=this.pendingExtendedCommandRequest;if(!t)return!1;if(this.isMenuSelectionInput(e)){const o=this.decodeMenuSelectionIndex(e),s=Number.isInteger(o)?t.menuIndexToCommandIndex.get(o):void 0;return Number.isInteger(s)?this.resolvePendingExtendedCommandRequest(s):(this.resolvePendingExtendedCommandRequest(-1),this.clearPendingInventoryContextSelection("extended command menu selection cancelled")),!0}const n=this.normalizeInputKey(e);return n==="Escape"?(this.resolvePendingExtendedCommandRequest(-1),this.clearPendingInventoryContextSelection("extended command prompt cancelled"),!0):this.isExtendedCommandSubmitToken(n)?(this.resolvePendingExtendedCommandRequestFromText(t.commandBuffer),!0):n==="Backspace"?(t.commandBuffer=t.commandBuffer.slice(0,-1),!0):typeof n=="string"&&n.length===1&&/^[A-Za-z0-9_?-]$/.test(n)?(t.commandBuffer+=n.toLowerCase(),!0):(this.resolvePendingExtendedCommandRequest(-1),this.clearPendingInventoryContextSelection("extended command input changed"),!1)}isLiteralTextInput(e){return typeof e!="string"||e.length<=1||this.isMetaInput(e)||this.isCtrlInput(e)?!1:!new Set(["Enter","Escape","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown","Numpad1","Numpad2","Numpad3","Numpad4","Numpad5","Numpad6","Numpad7","Numpad8","Numpad9","NumpadDecimal","Backspace","Space","Spacebar","Tab","Insert","Delete","F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"]).has(e)}isTextInputCommand(e){return typeof e=="string"&&e.startsWith(this.textInputPrefix)}isInventoryContextSelectionInput(e){return typeof e=="string"&&e.startsWith(this.inventoryContextSelectionPrefix)&&e.length>this.inventoryContextSelectionPrefix.length}isInventoryContextSelectionWithCountInput(e){return typeof e=="string"&&e.startsWith(this.inventoryContextSelectionCountPrefix)&&e.length>this.inventoryContextSelectionCountPrefix.length}isAnyInventoryContextSelectionInput(e){return this.isInventoryContextSelectionInput(e)||this.isInventoryContextSelectionWithCountInput(e)}armInventoryContextSelectionFromInput(e){if(this.isInventoryContextSelectionWithCountInput(e)){const t=e.slice(this.inventoryContextSelectionCountPrefix.length).trim(),n=t.indexOf(":");if(n<=0)return!1;const o=t.slice(0,n).trim(),s=t.slice(n+1).trim();if(o.length!==1||!/^\d+$/.test(s))return!1;const i=Number.parseInt(s,10);return!Number.isFinite(i)||i<1?!1:(this.pendingInventoryContextSelection={accelerator:o,count:i},console.log(`Armed inventory context selection accelerator with count: "${o}" x${i}`),!0)}if(this.isInventoryContextSelectionInput(e)){const t=e.slice(this.inventoryContextSelectionPrefix.length).trim();return t.length!==1?!1:(this.pendingInventoryContextSelection={accelerator:t},console.log(`Armed inventory context selection accelerator: "${t}"`),!0)}return!1}hasPendingInventoryContextSelection(){const e=this.pendingInventoryContextSelection;return e?String(e.accelerator||"").length===1:!1}clearPendingInventoryContextSelection(e=""){this.pendingInventoryContextSelection&&(this.pendingInventoryContextSelection=null,e&&console.log(`Cleared pending inventory context selection: ${e}`))}consumePendingInventoryContextSelection(e,t={}){const{clearOnMiss:n=!0}=t,o=this.pendingInventoryContextSelection;if(!o||!Array.isArray(e)||e.length===0)return null;const s=String(o.accelerator||""),i=Number.isFinite(o.count)&&Number(o.count)>0?Math.trunc(Number(o.count)):0;if(s.length!==1)return n&&this.clearPendingInventoryContextSelection("invalid accelerator"),null;const a=e.find(c=>c&&!c.isCategory&&typeof c.accelerator=="string"&&c.accelerator===s);if(a)return this.clearPendingInventoryContextSelection("consumed exact match"),{menuItem:a,selectionCount:i>0?i:void 0};const r=e.find(c=>c&&!c.isCategory&&typeof c.accelerator=="string"&&c.accelerator.toLowerCase()===s.toLowerCase());return r?(this.clearPendingInventoryContextSelection("consumed case-insensitive match"),{menuItem:r,selectionCount:i>0?i:void 0}):(n&&this.clearPendingInventoryContextSelection("no matching menu item"),null)}handleTextInputResponse(e,t="user"){const n=typeof e=="string"?e:String(e??"");if(this.pendingTextRequest){const s=this.pendingTextRequest;this.pendingTextRequest=null,this.writeTextInputBuffer(s.bufferPtr,n,s.maxLength),typeof s.resolve=="function"&&s.resolve(0);return}if(n.length===0)return;const o=this.pendingTextResponses.length;this.pendingTextResponses.push(n),console.log(`Queued text response input: "${n}"`,{source:t,queueBefore:o,queueAfter:this.pendingTextResponses.length,isLikelyNameInput:this.isLikelyNameInputForDebug(n)})}writeTextInputBuffer(e,t,n=256){if(!this.nethackModule||!e)return;const o=typeof t=="string"?t:String(t??""),s=Math.max(1,Math.floor(n)),i=o.slice(0,Math.max(0,s-1));if(!this.nethackModule.HEAPU8)return;let a=null;if(typeof TextEncoder<"u")a=new TextEncoder().encode(i);else{const g=unescape(encodeURIComponent(i)),w=new Uint8Array(g.length);for(let b=0;b<g.length;b+=1)w[b]=g.charCodeAt(b);a=w}const r=this.nethackModule.HEAPU8,c=Math.max(0,s-1),u=Math.max(0,r.length-e-1),d=Math.min(a.length,c,u);d>0&&r.set(a.slice(0,d),e),r[e+d]=0}resolveMenuSelection(e){if(this.menuSelectionReadyCount=e,this.isInMultiPickup=!1,this.pendingMenuSelection&&typeof this.pendingMenuSelection.resolver=="function"){const{resolver:t,menuListPtrPtr:n}=this.pendingMenuSelection;this.pendingMenuSelection=null,this.writeMenuSelectionResult(n||0,e),e<=0&&this.menuSelections.clear(),t(e),this.menuSelectionReadyCount=null;return}e<=0&&this.menuSelections.clear()}consumeInputResult(e,t,n=null){if(!e||e.cancelled)return typeof(e==null?void 0:e.cancelCode)=="number"?e.cancelCode:27;const o=e.token;if(t==="position"&&this.applyMouseTokenToPoskeyRequest(o,n)){if(this.contextualGlanceProbeMouseDeadlineMs>0){const a=Date.now();a<=this.contextualGlanceProbeMouseDeadlineMs&&(this.contextualGlanceAutoCancelPositionUntilMs=a+this.contextualGlanceAutoCancelPositionWindowMs),this.contextualGlanceProbeMouseDeadlineMs=0}return this.farLookMode==="active"&&this.farLookOrigin!=="look_menu"&&(this.farLookMode="none",this.farLookOrigin=null,this.setPositionInputActive(!1)),0}const s=o&&typeof o.key=="string"?o.key:"",i=t==="position"?this.normalizeFarLookPositionInput(s):s;return i?(this.farLookMode==="none"&&this.isPositionModeInitiatorInput(i)?(this.farLookMode="armed",this.farLookOrigin=this.pendingLookMenuFarLookArm?"look_menu":"direct",this.pendingLookMenuFarLookArm=!1):t==="event"&&this.farLookMode==="armed"?(this.farLookMode="none",this.farLookOrigin=null,this.pendingLookMenuFarLookArm=!1):this.pendingLookMenuFarLookArm&&(this.pendingLookMenuFarLookArm=!1),t==="position"&&this.farLookMode==="active"&&(this.isFarLookExitInput(i)||!this.isDirectionalMovementInput(i))&&(this.farLookMode="none",this.farLookOrigin=null,this.setPositionInputActive(!1)),this.awaitingQuestionInput&&this.updateNumberPadModeFromInput(i),this.processKey(i)):0}requestInputCode(e,t=null){if(this.activeInputRequest&&this.activeInputRequest.promise)return this.activeInputRequest.kind===e?this.activeInputRequest.promise:(console.log(`Deferring ${e} input request until pending ${this.activeInputRequest.kind} request completes`),this.activeInputRequest.promise.then(()=>this.requestInputCode(e,t)));const n=this.inputBroker.requestNext(e);if(n&&typeof n.then=="function"){let o=null;return o=n.then(s=>this.consumeInputResult(s,e,t)).finally(()=>{this.activeInputRequest&&this.activeInputRequest.promise===o&&(this.activeInputRequest=null)}),this.activeInputRequest={kind:e,promise:o},o}return this.consumeInputResult(n,e,t)}handleTileUpdateRequest(e,t){if(this.isClosed)return;console.log(`🔄 Client requested tile update for (${e}, ${t})`);const n=`${e},${t}`,o=this.gameMap.get(n);o?(console.log(`📤 Resending tile data for (${e}, ${t}):`,o),this.eventHandler&&this.queueMapGlyphUpdate({type:"map_glyph",x:o.x,y:o.y,glyph:o.glyph,char:o.char,color:o.color,tileIndex:o.tileIndex,window:2,isRefresh:!0})):(console.log(`⚠️ No tile data found for (${e}, ${t}) - tile may not be explored yet`),this.eventHandler&&this.emit({type:"tile_not_found",x:e,y:t,message:"Tile data not available - may not be explored yet"}))}handleAreaUpdateRequest(e,t,n=3){if(this.isClosed)return;console.log(`🔄 Client requested area update centered at (${e}, ${t}) with radius ${n}`);let o=0;for(let s=-n;s<=n;s++)for(let i=-n;i<=n;i++){const a=e+s,r=t+i,c=`${a},${r}`,u=this.gameMap.get(c);u&&(this.eventHandler&&this.queueMapGlyphUpdate({type:"map_glyph",x:u.x,y:u.y,glyph:u.glyph,char:u.char,color:u.color,tileIndex:u.tileIndex,window:2,isRefresh:!0,isAreaRefresh:!0}),o++)}console.log(`📤 Refreshed ${o} tiles in area around (${e}, ${t})`),this.eventHandler&&this.emit({type:"area_refresh_complete",centerX:e,centerY:t,radius:n,tilesRefreshed:o})}processKey(e){return e===" "||e==="Space"||e==="Spacebar"||e==="."||e==="Period"||e==="Decimal"||e==="NumpadDecimal"?46:e==="ArrowLeft"?(this.numberPadModeEnabled?"4":"h").charCodeAt(0):e==="ArrowRight"?(this.numberPadModeEnabled?"6":"l").charCodeAt(0):e==="ArrowUp"?(this.numberPadModeEnabled?"8":"k").charCodeAt(0):e==="ArrowDown"?(this.numberPadModeEnabled?"2":"j").charCodeAt(0):e==="Numpad1"?(this.numberPadModeEnabled?"1":"b").charCodeAt(0):e==="Numpad2"?(this.numberPadModeEnabled?"2":"j").charCodeAt(0):e==="Numpad3"?(this.numberPadModeEnabled?"3":"n").charCodeAt(0):e==="Numpad4"?(this.numberPadModeEnabled?"4":"h").charCodeAt(0):e==="Numpad5"?(this.numberPadModeEnabled?"5":".").charCodeAt(0):e==="Numpad6"?(this.numberPadModeEnabled?"6":"l").charCodeAt(0):e==="Numpad7"?(this.numberPadModeEnabled?"7":"y").charCodeAt(0):e==="Numpad8"?(this.numberPadModeEnabled?"8":"k").charCodeAt(0):e==="Numpad9"?(this.numberPadModeEnabled?"9":"u").charCodeAt(0):e==="Enter"?13:e==="Escape"?27:e.length>0?e.charCodeAt(0):0}isMetaInput(e){return typeof e=="string"&&e.startsWith(this.metaInputPrefix)&&e.length>this.metaInputPrefix.length}isCtrlInput(e){return typeof e=="string"&&e.startsWith(this.ctrlInputPrefix)&&e.length>this.ctrlInputPrefix.length}setPositionInputActive(e){const t=!!e;this.positionInputActive!==t&&(this.positionInputActive=t,t||(this.positionCursor=null),this.eventHandler&&this.emit({type:"position_input_state",active:t}))}emitPositionCursor(e,t,n,o="curs"){!Number.isFinite(t)||!Number.isFinite(n)||(this.positionCursor={x:t,y:n,window:e},this.eventHandler&&this.emit({type:"position_cursor",x:t,y:n,window:e,source:o}))}isPositionModeInitiatorInput(e){return e===";"}isFarLookPositionRequest(){return this.farLookMode==="armed"||this.farLookMode==="active"}isDirectionalMovementInput(e){return typeof e!="string"||e.length===0?!1:e.length===1?/^[hjklyubn]$/i.test(e)&&this.numberPadModeEnabled?!1:e==="h"||e==="j"||e==="k"||e==="l"||e==="y"||e==="u"||e==="b"||e==="n"||e==="H"||e==="J"||e==="K"||e==="L"||e==="Y"||e==="U"||e==="B"||e==="N"||this.numberPadModeEnabled&&(e==="1"||e==="2"||e==="3"||e==="4"||e==="6"||e==="7"||e==="8"||e==="9"):e==="ArrowLeft"||e==="ArrowRight"||e==="ArrowUp"||e==="ArrowDown"||e==="Home"||e==="End"||e==="PageUp"||e==="PageDown"||e==="Numpad1"||e==="Numpad2"||e==="Numpad3"||e==="Numpad4"||e==="Numpad6"||e==="Numpad7"||e==="Numpad8"||e==="Numpad9"}isFarLookExitInput(e){return e==="Escape"||e==="Enter"||e==="\r"||e===`
`}isPositionRequestContinuationInput(e){const t=this.normalizeInputKey(e);return typeof t!="string"||t.length===0?!1:this.isDirectionalMovementInput(t)||this.isFarLookExitInput(t)?!0:t==="."||t==="5"||t==="Numpad5"}normalizeFarLookPositionInput(e){return this.farLookMode!=="active"?e:e==="Enter"||e==="\r"||e===`
`?";":e}isPrintableAccelerator(e){return typeof e=="number"&&e>32&&e<127}normalizeNonNegativeInteger(e){const t=typeof e=="string"&&e.trim().length>0?Number(e):e;return typeof t!="number"||!Number.isFinite(t)||t<0?null:Math.trunc(t)}getNoGlyphValue(){const e=globalThis.nethackGlobal&&globalThis.nethackGlobal.constants&&globalThis.nethackGlobal.constants.GLYPH&&typeof globalThis.nethackGlobal.constants.GLYPH=="object"?globalThis.nethackGlobal.constants.GLYPH:null;if(!e)return null;const t=this.normalizeNonNegativeInteger(e.NO_GLYPH);return t!==null?t:this.normalizeNonNegativeInteger(e.MAX_GLYPH)}shouldCaptureWindowTextForDialog(e){return e===4||e===5||e===6}normalizePromptContextMessage(e){return typeof e!="string"?"":e.replace(/\u0000/g,"").trim()}rememberPromptContextMessage(e){const t=this.normalizePromptContextMessage(e);t&&(this.lastPromptContextMessage=t)}isRawPrintCallbackName(e){return e==="shim_raw_print"||e==="shim_raw_print_bold"}isPlayerMovementCallbackName(e){return e!=="shim_cliparound"?!1:!this.positionInputActive&&!this.isFarLookPositionRequest()}recordRecentUICallback(e,t){const n={name:typeof e=="string"?e:String(e??""),text:"",isPlayerMovement:!1};this.isRawPrintCallbackName(n.name)&&Array.isArray(t)&&(n.text=this.normalizePromptContextMessage(t[0])),n.isPlayerMovement=this.isPlayerMovementCallbackName(n.name),this.recentUICallbackHistory.push(n),this.recentUICallbackHistory.length>80&&this.recentUICallbackHistory.shift()}getRecentRawPrintContextMessage(){if(!Array.isArray(this.recentUICallbackHistory))return"";let e=-1;for(let n=this.recentUICallbackHistory.length-1;n>=0;n-=1){const o=this.recentUICallbackHistory[n];if(!(!o||o.name==="shim_getlin")){if(o.isPlayerMovement)break;if(this.isRawPrintCallbackName(o.name)&&o.text){e=n;break}}}if(e<0)return"";const t=[];for(let n=e;n>=0;n-=1){const o=this.recentUICallbackHistory[n];if(!o||o.isPlayerMovement||!this.isRawPrintCallbackName(o.name))break;o.text&&t.unshift(o.text)}return t.join(`
`)}getMostRecentToplineMessage(){const e=this.normalizePromptContextMessage(this.lastPromptContextMessage);if(e)return e;for(let t=this.gameMessages.length-1;t>=0;t-=1){const n=this.gameMessages[t];if(!n||Number(n.window)!==1)continue;const o=this.normalizePromptContextMessage(n.text);if(o)return o}return""}shouldAppendPreviousMessageToGetlinPrompt(e){return/^call\b/i.test(String(e||"").trim())}getGetlinPromptContextMessage(e){if(!this.shouldAppendPreviousMessageToGetlinPrompt(e))return"";const t=this.getRecentRawPrintContextMessage()||this.getMostRecentToplineMessage();if(!t)return"";const n=this.normalizePromptContextMessage(String(e||""));return n&&t.toLowerCase()===n.toLowerCase()?"":t}handleShimDisplayFile(e){const[t,n]=Array.isArray(e)?e:[],o=typeof t=="string"?t.trim():String(t??"").trim(),s=!!n;console.log(`DISPLAY FILE request: "${o||"<empty>"}" (mustExist=${s})`);const i=Et(o);if(i&&i.lines.length>0)return this.eventHandler&&this.emit({type:"info_menu",title:i.title,lines:i.lines,source:"display_file",file:i.canonicalName,mustExist:s}),0;const a=o?`No bundled help text available for "${o}".`:"No help file name was provided.";return console.warn(`DISPLAY FILE unavailable: ${a}`),s&&this.eventHandler&&this.emit({type:"text",text:a,window:5,attr:0,source:"display_file"}),0}shouldLogWindowTextInsteadOfDialog(e){if(!Array.isArray(e)||e.length===0)return!1;const t=e.map(o=>String(o||"").trim().toLowerCase()).filter(o=>o.length>0);if(t.length===0)return!1;const n=t[0];return n.startsWith("things that are here:")?!0:n.startsWith("there is a doorway here.")?t.some(o=>o.startsWith("things that are here:")):!1}emitWindowTextLinesToLog(e,t,n="display_nhwindow"){const o=Array.isArray(e)?e:[];for(const s of o){const i=String(s||"").replace(/\u0000/g,"");i.trim()&&(Number(t)===1&&this.rememberPromptContextMessage(i),this.gameMessages.push({text:i,window:t,timestamp:Date.now(),attr:0}),this.gameMessages.length>100&&this.gameMessages.shift(),this.eventHandler&&this.emit({type:"text",text:i,window:t,attr:0,source:n}))}}resetWindowTextBuffer(e){Number.isInteger(e)&&this.windowTextBuffers.set(e,[])}appendWindowTextBuffer(e,t){if(!Number.isInteger(e))return;const n=typeof t=="string"?t:String(t??""),o=this.windowTextBuffers.get(e);if(Array.isArray(o)){o.push(n);return}this.windowTextBuffers.set(e,[n])}consumeWindowTextBuffer(e){if(!Number.isInteger(e))return[];const t=this.windowTextBuffers.get(e);return this.windowTextBuffers.set(e,[]),Array.isArray(t)?t:[]}getWindowTextDialogTitle(e){return e===4||e===5?"NetHack Message":"NetHack Information"}getRecallableMessageHistoryLines(e=200){const t=Number.isFinite(e)?Math.max(1,Math.trunc(e)):200,n=[];for(const o of this.gameMessages){if(!o||typeof o.text!="string")continue;const s=o.text.replace(/\u0000/g,"");!s||Number(o.window)!==1||n.push(s)}return n.length<=t?n:n.slice(n.length-t)}classifyInventoryWindowMenu(e){const t=Array.isArray(e)?e:[],n=t.filter(c=>!c.isCategory),o=t.some(c=>c.isCategory),s=n.some(c=>this.isPrintableAccelerator(c.originalAccelerator)||typeof c.identifier=="number"&&c.identifier>0);return t.length===0?{kind:"inventory",lines:[]}:n.map(c=>String(c.text||"").trim().toLowerCase()).filter(c=>c.length>0).some(c=>c.includes("extended commands list"))?{kind:"info_menu",title:"NetHack Message",lines:n.map(u=>String(u.text||"").trim()).filter(u=>u.length>0)}:o||s?{kind:"inventory",lines:[]}:{kind:"info_menu",lines:n.map(c=>String(c.text||"").trim()).filter(c=>c.length>0)}}normalizeQuestionText(e){return typeof e!="string"?"":e.trim().toLowerCase()}isGameOverPossessionsIdentifyQuestion(e){const t=this.normalizeQuestionText(e);return t?t.includes("do you want your possessions identified"):!1}isNumberPadModeQuestion(e){const t=this.normalizeQuestionText(e);return t?t.startsWith("select number_pad mode"):!1}updateNumberPadModeFromInput(e){if(!this.isNumberPadModeQuestion(this.lastQuestionText))return;const t=typeof e=="string"&&e.startsWith("Numpad")?e.slice(6):e;if(t==="0"){this.numberPadModeEnabled=!1;return}(t==="1"||t==="2")&&(this.numberPadModeEnabled=!0)}isLookAtMenuQuestion(e){return this.normalizeQuestionText(e).includes("what do you want to look at")}isNameRootQuestion(e){const t=this.normalizeQuestionText(e);return t?t.startsWith("what do you want to name"):!1}resolveNameInventoryRouteMenuItem(e){if(!Array.isArray(e)||e.length===0)return null;const t=e.find(i=>i&&!i.isCategory&&typeof i.text=="string"&&i.text.toLowerCase().includes("particular object in inventory"));if(t)return t;const n=e.filter(i=>i&&!i.isCategory).map(i=>typeof i.text=="string"?i.text.trim().toLowerCase():"").filter(i=>i.length>0);return n.length===0||["a monster","the type of an object in inventory","the type of an object upon the floor","the type of an object on discoveries list","record an annotation for the current level"].filter(i=>n.some(a=>a.includes(i))).length<2?null:e.find(i=>i&&!i.isCategory&&typeof i.accelerator=="string"&&i.accelerator.toLowerCase()==="i")||null}resolveLookInventoryRouteMenuItem(e){if(!Array.isArray(e)||e.length===0)return null;const t=e.find(i=>i&&!i.isCategory&&typeof i.text=="string"&&i.text.toLowerCase().includes("something you're carrying"));if(t)return t;const n=e.filter(i=>i&&!i.isCategory).map(i=>typeof i.text=="string"?i.text.trim().toLowerCase():"").filter(i=>i.length>0);return n.length===0||["something on the map","something else (by symbol or name)"].filter(i=>n.some(a=>a.includes(i))).length<2?null:e.find(i=>i&&!i.isCategory&&typeof i.accelerator=="string"&&i.accelerator.toLowerCase()==="i")||null}tryAutoHandlePendingInventoryContextSelection(e,t,n={}){const o=typeof n.reason=="string"&&n.reason.trim()?n.reason.trim():"context action";if(!this.hasPendingInventoryContextSelection())return!1;if(this.isNameRootQuestion(e)){const i=this.resolveNameInventoryRouteMenuItem(t);if(i)return this.tryAutoSelectMenuItem(i,`${o} (#name inventory route)`)?!0:(this.clearPendingInventoryContextSelection("#name routing option unavailable"),!1)}if(this.isLookAtMenuQuestion(e)){const i=this.resolveLookInventoryRouteMenuItem(t);if(i&&this.tryAutoSelectMenuItem(i,`${o} (look inventory route)`))return!0}const s=this.consumePendingInventoryContextSelection(t);return s?this.tryAutoSelectMenuItem(s.menuItem,o,s.selectionCount):!1}tryAutoSelectMenuItem(e,t="context action",n){const o=this.createSelectionEntryFromMenuItem(e,n);if(!o)return!1;this.menuSelections.clear();const s=this.getMenuSelectionKey(o);return this.menuSelections.set(s,o),this.isInMultiPickup=!1,this.lastMenuInteractionCancelled=!1,console.log(`Auto-selected menu item via ${t}: ${o.menuChar} (${o.text})`),!0}isLookAtMapMenuSelection(e){if(!e||e.isCategory)return!1;const t=typeof e.accelerator=="string"?e.accelerator:"",n=e.originalAccelerator,o=e.identifier;return t==="/"||n===47||o===47?this.isLookAtMenuQuestion(this.currentMenuQuestionText)?!0:String(e.text||"").trim().toLowerCase()==="something on the map":!1}isMenuSelectionInput(e){return typeof e=="string"&&e.startsWith(this.menuSelectionInputPrefix)&&e.length>this.menuSelectionInputPrefix.length}decodeMenuSelectionIndex(e){if(!this.isMenuSelectionInput(e))return null;const t=e.slice(this.menuSelectionInputPrefix.length).trim();if(!/^-?\d+$/.test(t))return null;const n=Number(t);return Number.isInteger(n)?n:null}getMenuSelectionKey(e){return`menu-index:${Number.isInteger(e==null?void 0:e.menuIndex)?e.menuIndex:-1}`}createSelectionEntryFromMenuItem(e,t){if(!e)return null;const n=Number.isFinite(t)&&Number(t)>0?Math.trunc(Number(t)):void 0;return{menuChar:e.accelerator,originalAccelerator:e.originalAccelerator,identifier:e.identifier,menuIndex:e.menuIndex,text:e.text,count:n}}getMenuSelectionWakeInput(e){if(this.isLookAtMapMenuSelection(e))return this.pendingLookMenuFarLookArm=!0,console.log("Look menu map selection detected; using ';' wake input to arm far-look mode"),";";if(e&&typeof e.accelerator=="string"&&e.accelerator.length===1)return e.accelerator;const t=e==null?void 0:e.originalAccelerator;return this.isPrintableAccelerator(t)?String.fromCharCode(t):"Enter"}resolveMenuItemFromSelectionInput(e){const t=this.decodeMenuSelectionIndex(e);return!Number.isInteger(t)||!Array.isArray(this.currentMenuItems)||this.currentMenuItems.length===0?null:this.currentMenuItems.find(n=>n&&!n.isCategory&&Number.isInteger(n.menuIndex)&&n.menuIndex===t)||null}isContainerLootTypeQuestion(e){const t=this.normalizeQuestionText(e),n=t.includes("what types of objects")||t.includes("what type of objects"),o=t.includes("take out")||t.includes("put in");return n&&o}isMultiSelectLootQuestion(e){const t=this.normalizeQuestionText(e);return t.includes("pick up what")||t.includes("what do you want to pick up")||t.includes("what would you like to drop")||t.includes("drop what type of items")||t.includes("take out what")||t.includes("what do you want to take out")||t.includes("what would you like to take out")||t.includes("put in what")||t.includes("what do you want to put in")||t.includes("what would you like to put in")||t.includes("put in, then take out what")||t.includes("take out, then put in what")}consumeQueuedExtendedCommandInput(){let e="";for(;;){const t=this.inputBroker.dequeueToken("event");if(!t)break;const n=t.key;if(n==null)continue;if(n==="Escape")return null;if(n==="Enter"||n==="\r"||n===`
`)break;if(n==="Backspace"){e=e.slice(0,-1);continue}let o=null;if(typeof n=="string"&&n.length===1)o=n;else{this.inputBroker.prependToken(t);break}if(!(!o||o==="#")){if(/^[A-Za-z0-9_?-]$/.test(o)){e+=o.toLowerCase();continue}this.inputBroker.prependToken(t);break}}return e}resolveExtendedCommandIndex(e){const t=String(e||"").trim().toLowerCase().replace(/^#+/,"");if(!t)return-1;const n=this.getExtendedCommandEntries();if(!n.length)return-1;const o=n.find(i=>i.name===t);if(o)return o.index;const s=n.filter(i=>i.name.startsWith(t));return s.length===1?s[0].index:-1}resolveMetaBoundExtendedCommandName(e){if(typeof e!="string"||e.length===0)return null;const t=e.charAt(0).toLowerCase();if(!/^[a-z]$/.test(t))return null;const n=t.charCodeAt(0)|128,o=this.getExtendedCommandEntries().filter(i=>i.keyCode===n);if(o.length===0)return null;const s=o.find(i=>i.name!=="#"&&i.name!=="?")||o[0];return s&&typeof s.name=="string"?s.name:null}getExtendedCommandEntries(){if(Array.isArray(this.extendedCommandEntries)&&this.extendedCommandEntries.length>0)return this.extendedCommandEntries;const e=this.extractExtendedCommandEntriesFromMemory();return e.length>0?(this.extendedCommandEntries=e,e):(this.extendedCommandEntries=this.getFallbackExtendedCommandEntries(),this.extendedCommandEntries)}emitExtendedCommands(e="runtime"){if(!this.eventHandler)return;const t=this.getExtendedCommandEntries(),n=[],o=new Set;for(const s of t){const i=String((s==null?void 0:s.name)||"").trim().toLowerCase();!i||i==="#"||i==="?"||o.has(i)||(o.add(i),n.push(i))}this.emit({type:"extended_commands",commands:n,source:e})}extractExtendedCommandEntriesFromMemory(){if(!this.nethackModule||!this.nethackModule.HEAPU8||!this.nethackModule.HEAP32)return[];const e=this.nethackModule.HEAPU8,t=[24,20];for(const n of t){const o=n===24?16:12,s=e.length-n;for(let i=0;i<=s;i+=4){if(e[i]!==35)continue;const a=this.nethackModule.HEAP32[i+4>>2];if(this.readHeapCString(a,4)!=="#")continue;const r=this.nethackModule.HEAP32[i+8>>2];if(this.readHeapCString(r,64)!=="perform an extended command")continue;const c=this.readExtendedCommandEntriesFromBase(i,n,o);if(c.length>=20&&c[0].name==="#"&&c.some(u=>u.name==="pray")&&c.some(u=>u.name==="chat"))return console.log(`Resolved extended command table from WASM memory (${c.length} entries, stride=${n}, base=${i})`),c}}return[]}readExtendedCommandEntriesFromBase(e,t,n){if(!this.nethackModule||!this.nethackModule.HEAPU8||!this.nethackModule.HEAP32)return[];const o=this.nethackModule.HEAPU8,s=this.nethackModule.HEAP32,i=[];for(let a=0;a<256;a++){const r=e+a*t;if(r+t>o.length)break;const c=s[r>>2],u=s[r+4>>2];if(!Number.isInteger(u)||u<=0)break;const d=this.readHeapCString(u,64);if(!this.isLikelyExtendedCommandName(d)){if(a===0)return[];break}const g=s[r+n>>2];i.push({index:a,name:d.toLowerCase(),keyCode:Number.isInteger(c)?c:0,flags:Number.isInteger(g)?g:0})}return i}readHeapCString(e,t=128){if(!this.nethackModule||!this.nethackModule.HEAPU8||!Number.isInteger(e)||e<=0)return"";const n=this.nethackModule.HEAPU8;if(e>=n.length)return"";const o=Math.min(n.length,e+t);let s="";for(let i=e;i<o;i++){const a=n[i];if(a===0)break;if(a<32||a>126)return"";s+=String.fromCharCode(a)}return s}isLikelyExtendedCommandName(e){return typeof e=="string"&&e.length>0&&e.length<=32&&/^[A-Za-z0-9_?#-]+$/.test(e)}getFallbackExtendedCommandEntries(){const e=["#","?","adjust","annotate","apply","attributes","autopickup","call","cast","chat","close","conduct","dip","drop","droptype","eat","engrave","enhance","explode","fight","fire","force","getpos","glance","history","invoke","jump","kick","known","knownclass","look","loot","monster","monsters","name","namefloor","offer","open","options","overview","pay","pickup","pray","prevmsg","puton","quaff","quit","quiver","read","redraw","remove","ride","rub","seeall","seeamulet","seegold","seeinv","seespells","semicolon","set","shell","sit","spells","takeoff","takeoffall","teleport","terrain","throw","tip","travel","turn","twoweapon","untrap","version","versionshort","wield","wipe","wear","whatdoes","whatis","wieldquiver","zap"],t={adjust:"a",chat:"c",dip:"d",enhance:"e",force:"f",invoke:"i",jump:"j",loot:"l",monster:"m",offer:"o",pray:"p",quit:"q",rub:"r",sit:"s",turn:"t",untrap:"u",version:"v",wipe:"w"};return console.log(`Using fallback extended command table (${e.length} entries)`),e.map((n,o)=>({index:o,name:n,keyCode:t[n]?t[n].charCodeAt(0)|128:0,flags:0}))}getStatusFieldName(e){if(typeof e!="number")return String(e);if(e===-1)return"BL_FLUSH";if(e===-2)return"BL_RESET";if(e===-3)return"BL_CHARACTERISTICS";if(e===23)return"BL_FLUSH";if(e===24)return"BL_RESET";if(e===25)return"BL_CHARACTERISTICS";const t=globalThis.nethackGlobal&&globalThis.nethackGlobal.constants?globalThis.nethackGlobal.constants:null;if(t&&t.STATUS_FIELD&&t.STATUS_FIELD[e]!==void 0)return String(t.STATUS_FIELD[e]);const n=this.getRuntimeStatusFieldMap();return n&&n[e]!==void 0?String(n[e]):`FIELD_${e}`}decodeShimArgValue(e,t,n){if(!this.nethackModule||typeof this.nethackModule.getValue!="function"||!globalThis.nethackGlobal||!globalThis.nethackGlobal.helpers||typeof globalThis.nethackGlobal.helpers.getPointerValue!="function")return null;const o=this.nethackModule.getValue(t,"*");return globalThis.nethackGlobal.helpers.getPointerValue(e,o,n)}decodeStatusValue(e,t){if(new Set(["BL_RESET","BL_FLUSH","BL_CHARACTERISTICS"]).has(e))return{value:0,valueType:"i"};if(e==="BL_CONDITION")try{return{value:this.nethackModule.getValue(t,"i32"),valueType:"i"}}catch(o){return console.log(`Status int decode failed for ${e} at ptr ${t}`,o),{value:0,valueType:"i"}}try{return{value:this.nethackModule.UTF8ToString(t),valueType:"s"}}catch{return{value:"",valueType:"s"}}}normalizeRuntimeInteger(e){if(typeof e=="number"&&Number.isFinite(e))return Math.trunc(e);const t=String(e??"").trim();if(!t)return null;if(/^-?\d+$/.test(t)){const n=Number.parseInt(t,10);return Number.isFinite(n)?n:null}return null}cloneRuntimeValueForSnapshot(e,t=0,n=new WeakSet){if(e==null)return e??null;const o=typeof e;if(o==="string"||o==="number"||o==="boolean")return e;if(o==="bigint")return String(e);if(o==="function")return`[Function ${typeof e.name=="string"&&e.name.trim()?e.name.trim():"anonymous"}]`;if(o!=="object")return String(e);if(n.has(e))return"[Circular]";if(t>=6)return"[MaxDepth]";if(n.add(e),Array.isArray(e)){const c=e.slice(0,300).map(u=>this.cloneRuntimeValueForSnapshot(u,t+1,n));return e.length>300&&c.push(`[Truncated ${e.length-300} items]`),c}const s={},i=Object.keys(e),a=400;for(let r=0;r<i.length&&r<a;r+=1){const c=i[r];try{s[c]=this.cloneRuntimeValueForSnapshot(e[c],t+1,n)}catch(u){const d=u instanceof Error&&u.message?u.message:String(u);s[c]=`[ReadError: ${d}]`}}return i.length>a&&(s.__truncatedKeys=i.length-a),s}buildRuntimeGlobalsSnapshot(){const e=globalThis.nethackGlobal&&typeof globalThis.nethackGlobal=="object"?globalThis.nethackGlobal:null;if(!e)return{capturedAtMs:Date.now(),runtimeVersion:this.runtimeVersion,nethackGlobal:null};const t=e.helpers&&typeof e.helpers=="object"?Object.keys(e.helpers).sort():[],n=this.buildObjectTileIndexByObjectIdSnapshot();return{capturedAtMs:Date.now(),runtimeVersion:this.runtimeVersion,objectTileIndexByObjectId:n,nethackGlobal:{keys:Object.keys(e).sort(),globals:this.cloneRuntimeValueForSnapshot(e.globals),constants:this.cloneRuntimeValueForSnapshot(e.constants),pointers:this.cloneRuntimeValueForSnapshot(e.pointers),helperKeys:t}}}buildObjectTileIndexByObjectIdSnapshot(){const e=globalThis.nethackGlobal&&typeof globalThis.nethackGlobal=="object"?globalThis.nethackGlobal:null;if(!e)return null;const t=e.constants&&typeof e.constants=="object"?e.constants:null,n=t&&t.GLYPH&&typeof t.GLYPH=="object"?t.GLYPH:null;if(!n)return null;const o=this.normalizeNonNegativeInteger(n.GLYPH_OBJ_OFF),s=this.normalizeNonNegativeInteger(n.GLYPH_CMAP_OFF);if(o===null||s===null||s<=o)return null;const i=s-o;if(i<=0||i>8192)return null;const a=e.helpers&&typeof e.helpers=="object"?e.helpers:null,r=a&&typeof a.tileIndexForGlyph=="function"?a.tileIndexForGlyph:null;if(!r)return null;const c=new Array(i).fill(-1);for(let u=0;u<i;u+=1){const d=o+u;try{const g=r(d);typeof g=="number"&&Number.isFinite(g)&&g>=0&&(c[u]=Math.trunc(g))}catch{c[u]=-1}}return c}resolveDungeonByIndex(e,t){if(Array.isArray(e))return e[t]??null;if(e&&typeof e=="object"){if(Object.prototype.hasOwnProperty.call(e,t))return e[t];const n=String(t);if(Object.prototype.hasOwnProperty.call(e,n))return e[n]}return null}resolveRuntimeBranchTag(e,t){var r;if(!t||typeof t!="object")return null;const n=this.normalizeRuntimeInteger(t.d_mines_dnum),o=this.normalizeRuntimeInteger(t.d_quest_dnum),s=this.normalizeRuntimeInteger(t.d_sokoban_dnum),i=this.normalizeRuntimeInteger(t.d_tower_dnum),a=this.normalizeRuntimeInteger((r=t.d_astral_level)==null?void 0:r.dnum);return e===0?"dungeons_of_doom":e===n?"mines":e===o?"quest":e===s?"sokoban":e===i?"vlads_tower":e===a?"endgame":null}resolveRuntimeLevelIdentity(){const e=globalThis.nethackGlobal&&globalThis.nethackGlobal.globals&&typeof globalThis.nethackGlobal.globals=="object"?globalThis.nethackGlobal.globals:null;if(!e)return null;try{const t=e.g&&typeof e.g=="object"?e.g:null,n=e.u??(t==null?void 0:t.u),o=n&&typeof n=="object"?n.uz:null,s=o&&typeof o=="object"?this.normalizeRuntimeInteger(o.dnum):null,i=o&&typeof o=="object"?this.normalizeRuntimeInteger(o.dlevel):null;if(s===null||i===null)return this.logMissingRuntimeLevelIdentityGlobals(e),null;const a=e.dungeons??(t==null?void 0:t.dungeons),r=this.resolveDungeonByIndex(a,s),c=r&&typeof r=="object"&&typeof r.dname=="string"&&r.dname.trim()||null,u=r&&typeof r=="object"?this.normalizeRuntimeInteger(r.ledger_start):null,d=r&&typeof r=="object"?this.normalizeRuntimeInteger(r.depth_start):null,g=u!==null?Math.trunc(i+u):null,w=d!==null?Math.trunc(d+i-1):null,b=e.dungeon_topology&&typeof e.dungeon_topology=="object"?e.dungeon_topology:t!=null&&t.dungeon_topology&&typeof t.dungeon_topology=="object"?t.dungeon_topology:null,x=this.resolveRuntimeBranchTag(s,b);return{dnum:s,dlevel:i,ledgerNo:g,depth:w,dungeonName:c,branchTag:x}}catch(t){return console.log("Failed to resolve runtime level identity:",t),null}}logMissingRuntimeLevelIdentityGlobals(e){if(this.didLogMissingLevelIdentityGlobals)return;this.didLogMissingLevelIdentityGlobals=!0;const t=e&&typeof e=="object"?Object.keys(e).sort():[],n=e&&typeof e=="object"&&e.g&&typeof e.g=="object"?Object.keys(e.g).sort():[];console.warn("[LEVEL_IDENTITY_DEBUG] Runtime globals missing exported level identity fields (expected u.uz/dungeons/dungeon_topology).",{topLevelKeys:t,nestedGKeys:n})}shouldUseAllCountForMenuItem(e){if(!e||typeof e.text!="string")return!1;const t=e.text.trim();return t?!!(/^\d+\s+/.test(t)||/\(\d+\)\s*$/.test(t)||/\bgold pieces?\b/i.test(t)):!1}writeMenuSelectionResult(e,t){if(!this.nethackModule||!e)return;const n=this.nethackModule.HEAPU8&&this.nethackModule.HEAPU8.length?this.nethackModule.HEAPU8.length:0,o=Number.isInteger(e)&&e>0&&(e&3)===0,s=!n||e+4<=n;if(!o||!s){console.log(`Skipping menu selection write: invalid menuListPtrPtr=${e} (aligned=${o}, inBounds=${s}, heapSize=${n})`);return}try{const i=Array.from(this.menuSelections.values()),a=this.runtimeVersion==="3.7"?12:8,r=4,c=8,u=k=>Number.isInteger(k)&&k>=0&&k+4<=a;if(t<=0){this.nethackModule.setValue(e,0,"*"),console.log(`Menu selection write: cleared output pointer at menuListPtrPtr=${e}`);return}const d=this.nethackModule.getValue(e,"*"),g=this.nethackModule._malloc(t*a);this.nethackModule.setValue(e,g,"*"),this.nethackModule.HEAPU8&&a>0&&this.nethackModule.HEAPU8.fill(0,g,g+t*a);const w=this.nethackModule.getValue(e,"*");console.log(`Writing ${t} selections at outPtr=${g} (menuListPtrPtr=${e}, priorOutPtr=${d}, confirmOutPtr=${w}, stride=${a}, countOffsetPrimary=${r}, itemFlagsOffset=${c})`);for(let k=0;k<i.length;k++){const M=i[k],q=g+k*a;let _=this.runtimeVersion==="3.7"||typeof M.identifier=="number"?M.identifier:M.originalAccelerator;if(typeof _!="number"&&typeof M.menuChar=="string"&&M.menuChar.length===1&&(_=M.menuChar.charCodeAt(0)),typeof _!="number"){console.log(`Skipping item ${k} because identifier is not numeric:`,_);continue}this.nethackModule.setValue(q,_,"i32");const C=jt.env.NH_MENU_COUNT_MODE||"auto",Q=C==="all"||C==="auto"&&this.shouldUseAllCountForMenuItem(M),Y=Number.isFinite(M==null?void 0:M.count)&&Number(M.count)>0?Math.trunc(Number(M.count)):null,L=Y!==null?Y:Q?-1:1;u(r)&&this.nethackModule.setValue(q+r,L,"i32"),u(c)&&c!==r&&this.nethackModule.setValue(q+c,0,"i32");const E=this.nethackModule.getValue(q,"i32"),ue=u(r)?this.nethackModule.getValue(q+r,"i32"):null,ce=u(c)&&c!==r?this.nethackModule.getValue(q+c,"i32"):null;console.log(`Wrote menu_item[${k}] => item=${E}, countPrimary=${ue}, itemFlags=${ce}, countMode=${C}, countValue=${L}`)}const b=Math.min(t*a,64),x=[];for(let k=0;k<b;k++){const M=this.nethackModule.getValue(g+k,"i8")&255;x.push(M.toString(16).padStart(2,"0"))}console.log(`menu_item buffer dump (${b} bytes): ${x.join(" ")}`)}catch(i){console.log("Error writing selections to NetHack memory:",i)}}resolveWasmAssetUrl(e){const t=String(e||"").replace(/^\/+/,""),n=typeof import.meta<"u"&&Ut?"./":"/",o=typeof globalThis<"u"&&globalThis.location&&typeof globalThis.location.href=="string"?globalThis.location.href:"";if(o.startsWith("file:")&&(n==="./"||n==="."))try{return new URL(`../${t}`,o).toString()}catch{}return`${n.endsWith("/")?n:`${n}/`}${t}`}async initializeNetHack(){var e,t;try{console.log("Starting local NetHack session..."),globalThis.nethackCallback=async(u,...d)=>this.handleUICallback(u,d),this.runtimeVersion=this.normalizeRuntimeVersion((e=this.startupOptions)==null?void 0:e.runtimeVersion);const n=this.normalizeRuntimeVersion((t=this.startupOptions)==null?void 0:t.runtimeVersion),o=n==="3.7"?"nethack-37.wasm":"nethack-367.wasm";globalThis.nethackGlobal||(globalThis.nethackGlobal={constants:{WIN_TYPE:{1:"WIN_MESSAGE",2:"WIN_MAP",3:"WIN_STATUS",4:"WIN_INVEN"},STATUS_FIELD:{},MENU_SELECT:{PICK_NONE:0,PICK_ONE:1,PICK_ANY:2}},helpers:{getPointerValue:(u,d,g)=>{if(!this.nethackModule)return d;switch(g){case"s":return d?this.nethackModule.UTF8ToString(d):"";case"p":return d?this.nethackModule.getValue(d,"*"):0;case"c":return String.fromCharCode(this.nethackModule.getValue(d,"i8"));case"b":return this.nethackModule.getValue(d,"i8")!==0;case"0":return this.nethackModule.getValue(d,"i8");case"1":return this.nethackModule.getValue(d,"i16");case"2":case"i":case"n":return this.nethackModule.getValue(d,"i32");case"f":return this.nethackModule.getValue(d,"float");case"d":return this.nethackModule.getValue(d,"double");case"o":return d;default:return d}},setPointerValue:(u,d,g,w=0)=>{if(this.nethackModule)switch(g){case"s":this.nethackModule.stringToUTF8(String(w),d,1024);break;case"i":this.nethackModule.setValue(d,w,"i32");break;case"c":this.nethackModule.setValue(d,w,"i8");break;case"f":this.nethackModule.setValue(d,w,"float");break;case"d":this.nethackModule.setValue(d,w,"double");break;case"v":break;default:break}}},globals:{WIN_MAP:2,WIN_INVEN:4,WIN_STATUS:3,WIN_MESSAGE:1}}),this.seedRuntimeStatusFieldConstants();const s=["number_pad:1","mouse_support","clicklook","runmode:walk","time","showexp","showscore","statushilites","force_invmenu","boulder:0"],i=this.buildCharacterCreationRuntimeOptions();i.length>0&&s.push(...i);const a=this.buildStartupInitRuntimeOptions();a.length>0&&s.push(...a);const r=await this.loadRuntimeFactory(n);this.nethackInstance=await r({noInitialRun:!0,locateFile:u=>u.endsWith(".wasm")?this.resolveWasmAssetUrl(o):this.resolveWasmAssetUrl(u),quit:(u,d)=>{const g=Number.isFinite(u)?Number(u):0,w=d&&typeof d=="object"&&d.message?String(d.message):`Program terminated with exit(${g})`;if(this.nethackModule&&this.nethackModule.FS?this.nethackModule.FS.syncfs(!1,()=>{this.emit({type:"runtime_terminated",reason:w,exitCode:g})}):this.emit({type:"runtime_terminated",reason:w,exitCode:g}),d)throw d},onExit:u=>{const d=Number.isFinite(u)?Number(u):0;this.nethackModule&&this.nethackModule.FS?this.nethackModule.FS.syncfs(!1,()=>{this.emit({type:"runtime_terminated",reason:`Program terminated with exit(${d})`,exitCode:d})}):this.emit({type:"runtime_terminated",reason:`Program terminated with exit(${d})`,exitCode:d})},onAbort:u=>{const d=typeof u=="string"&&u.trim()?u.trim():String(u??"Runtime aborted");this.emit({type:"runtime_error",error:d})},preRun:[u=>{u.ENV=u.ENV||{};const d=typeof u.ENV.NETHACKOPTIONS=="string"?u.ENV.NETHACKOPTIONS.trim():"";u.ENV.NETHACKOPTIONS=d?`${d},${s.join(",")}`:s.join(","),console.log(`Configured NETHACKOPTIONS: ${u.ENV.NETHACKOPTIONS}`);const g=u.FS&&u.FS.filesystems&&u.FS.filesystems.IDBFS?u.FS.filesystems.IDBFS:u.IDBFS;if(u.FS&&g){const w=u.FS.cwd(),b=w==="/"?"/save":`${w}/save`;if(!u.FS.analyzePath(b).exists)try{u.FS.mkdir(b)}catch(x){console.warn(`Failed to create ${b}`,x)}try{u.FS.mount(g,{},b),u.addRunDependency("idbfs_sync"),u.FS.syncfs(!0,x=>{x?console.warn("IDBFS load syncfs error:",x):console.log(`IDBFS mounted and synced at ${b}`),u.removeRunDependency("idbfs_sync")})}catch(x){console.warn(`Failed to mount IDBFS at ${b}`,x)}}}]}),this.nethackModule=this.nethackInstance,this.nethackInstance.cwrap("shim_graphics_set_callback",null,["string"])("nethackCallback"),this.installHelperCompatibilityShims(),this.nethackInstance._main(0,0)}catch(n){throw console.error("Error initializing local NetHack:",n),n}}installHelperCompatibilityShims(){if(!globalThis.nethackGlobal||!globalThis.nethackGlobal.helpers||typeof globalThis.nethackGlobal.helpers.getPointerValue!="function")return;const e=globalThis.nethackGlobal.helpers,t=e.getPointerValue;if(t&&t.__nh3dVoidCompatPatched)return;const n=(o,s,i)=>i==="v"?0:t(o,s,i);n.__nh3dVoidCompatPatched=!0,e.getPointerValue=n}waitForQuestionInput(){this.awaitingQuestionInput=!0;const e=this.requestInputCode("event");return e&&typeof e.then=="function"?e.finally(()=>{this.awaitingQuestionInput=!1}):(this.awaitingQuestionInput=!1,e)}handleShimGetNhEvent(){return 0}handleShimNhGetch(){return this.requestInputCode("event")}handleShimYnFunction(e){const[t,n,o]=e;return console.log(`Y/N Question: "${t}" choices: "${n}" default: ${o}`),this.lastQuestionText=t,this.pendingGameOverPossessionsInventoryFlow=this.isGameOverPossessionsIdentifyQuestion(t),this.isContainerLootTypeQuestion(t)?(console.log('Auto-answering container loot type question with "a"'),this.processKey("a")):t&&t.toLowerCase().includes("direction")?(this.eventHandler&&this.emit({type:"direction_question",text:t,choices:n,default:o}),this.waitForQuestionInput()):(this.eventHandler&&this.emit({type:"question",text:t,choices:n,default:o,menuItems:[]}),this.waitForQuestionInput())}handleShimNhPoskey(e){const[t,n,o]=e;if(console.log("NetHack requesting position key"),this.contextualGlanceAutoCancelPositionUntilMs>0){if(Date.now()<=this.contextualGlanceAutoCancelPositionUntilMs)return console.log("Auto-canceling contextual glance follow-up position request"),this.contextualGlanceAutoCancelPositionUntilMs=0,this.setPositionInputActive(!1),this.processKey("Escape");this.contextualGlanceAutoCancelPositionUntilMs=0}return this.farLookMode==="armed"?(this.farLookMode="active",this.setPositionInputActive(!0),this.positionCursor||this.emitPositionCursor(null,this.playerPosition.x,this.playerPosition.y,"nh_poskey_start")):this.farLookMode==="active"?this.setPositionInputActive(!0):this.setPositionInputActive(!1),this.requestInputCode("position",{xPtr:t,yPtr:n,modPtr:o})}handleShimGetlin(e){const[t,n]=e,o=typeof t=="string"?t:String(t??""),s=this.getGetlinPromptContextMessage(o);console.log(`Text input requested: "${o}"`),s&&console.log(`Text input context for Call prompt: "${s}"`);const i=this.resolveTextInputBufferPointer(n);if(!i)return console.log(`Unable to resolve getlin buffer pointer (raw=${n}); returning empty response`),0;if(this.pendingTextResponses.length>0){const a=String(this.pendingTextResponses.shift()||"");return this.writeTextInputBuffer(i,a,this.textInputMaxLength),0}return this.eventHandler?(this.pendingTextRequest&&this.handleTextInputResponse("\x1B","system"),this.emit({type:"text_request",text:o,contextMessage:s||void 0,maxLength:this.textInputMaxLength}),new Promise(a=>{this.pendingTextRequest={bufferPtr:i,resolve:a,maxLength:this.textInputMaxLength}})):(this.writeTextInputBuffer(i,"",this.textInputMaxLength),0)}handleUICallback(e,t){var s,i,a,r,c,u,d;if(this.isClosed)return 0;console.log(`🎮 UI Callback: ${e}`,t),this.recordRecentUICallback(e,t);const o={shim_get_nh_event:()=>this.handleShimGetNhEvent(),shim_nhgetch:()=>this.handleShimNhGetch(),shim_yn_function:()=>this.handleShimYnFunction(t),shim_nh_poskey:()=>this.handleShimNhPoskey(t),shim_getlin:()=>this.handleShimGetlin(t)}[e];if(o)return o();switch(e){case"shim_get_ext_cmd":const g=this.dequeuePendingExtendedCommandSubmission(),w=g!==void 0?g:this.consumeQueuedExtendedCommandInput();if(w===null)return console.log("Extended command cancelled before submission"),-1;if(!w)return this.startupExtmenuEnabled?(console.log("Extended command submission was empty; awaiting extmenu selection"),this.requestExtendedCommandSelectionFromUi()):(console.log("Extended command submission was empty"),-1);const b=this.resolveExtendedCommandIndex(w);return b<0?(console.log(`Unknown extended command "${w}" (canceling command)`),-1):(console.log(`Resolved extended command "${w}" to index ${b}`),b);case"shim_init_nhwindows":return this.nameInitDebugCounter+=1,console.log("[NAME_DEBUG] shim_init_nhwindows",{callId:this.nameInitDebugCounter,args:t,pendingTextResponses:this.pendingTextResponses.length,configuredName:this.normalizeCharacterNameValue((i=(s=this.startupOptions)==null?void 0:s.characterCreation)==null?void 0:i.name)}),this.eventHandler&&this.emit({type:"name_request",text:"What is your name, adventurer?",maxLength:30,source:"init_nhwindows",callId:this.nameInitDebugCounter}),1;case"shim_create_nhwindow":const[x]=t;return this.resetWindowTextBuffer(x),console.log(`Creating window [ ${x} ] returning ${x}`),x;case"shim_status_init":return console.log("Initializing status display"),0;case"shim_start_menu":const[k,M]=t;return console.log("NetHack starting menu:",t),this.currentMenuItems=[],this.currentWindow=k,this.currentMenuQuestionText="",this.lastQuestionText=null,this.lastEndedMenuWindow=null,this.lastEndedMenuHadQuestion=!1,this.lastEndedInventoryMenuKind=null,this.lastMenuInteractionCancelled=!1,this.resetWindowTextBuffer(k),this.menuSelections.clear(),this.isInMultiPickup=!1,this.menuSelectionReadyCount=null,this.pendingMenuSelection&&(console.log("Clearing previous pending menu selection resolver"),this.pendingMenuSelection=null),console.log(`📋 Starting menu for window ${k} (${{1:"WIN_MESSAGE",2:"WIN_MAP",3:"WIN_STATUS",4:"WIN_INVEN"}[k]||"UNKNOWN"})`),0;case"shim_end_menu":const[_,C]=t;console.log("NetHack ending menu:",t);const Q=_===4,Y=typeof C=="string"?C:"",L=Y.trim().length>0;if(this.currentMenuQuestionText=L?Y:"",this.lastEndedMenuWindow=_,this.lastEndedMenuHadQuestion=L,this.lastEndedInventoryMenuKind=null,console.log(`📋 Menu ending - Window: ${_}, Question: "${C}", Items: ${this.currentMenuItems.length}`),Q&&!L){const h=this.classifyInventoryWindowMenu(this.currentMenuItems);this.lastEndedInventoryMenuKind=h.kind;const m=this.currentMenuItems.filter(y=>!y.isCategory),f=this.currentMenuItems.filter(y=>y.isCategory);if(console.log(`WIN_INVEN no-question menu classified as ${h.kind} (${m.length} items, ${f.length} categories)`),this.eventHandler)if(h.kind==="inventory")this.latestInventoryItems=this.currentMenuItems.map(y=>({...y})),this.emit({type:"inventory_update",items:this.latestInventoryItems.map(y=>({...y})),window:_});else{const y=h.lines,p=typeof h.title=="string"&&h.title.trim().length>0?h.title.trim():"",v=p||(y.length>0?y[0]:"NetHack Information"),H=p?y:y.length>1?y.slice(1):y;this.emit({type:"info_menu",title:v,lines:H,window:_})}return 0}if(Q&&L)return this.lastEndedInventoryMenuKind="inventory",console.log(`📋 Inventory action question detected: "${C}" with ${this.currentMenuItems.length} items`),this.tryAutoHandlePendingInventoryContextSelection(C,this.currentMenuItems,{reason:"context action"})?0:(this.isMultiSelectLootQuestion(C)&&(console.log("Multi-select loot dialog detected"),this.isInMultiPickup=!0),this.eventHandler&&this.emit({type:"question",text:C,choices:"",default:"",menuItems:this.currentMenuItems}),console.log("📋 Waiting for inventory action selection (async)..."),this.waitForQuestionInput());if(L&&this.currentMenuItems.length>0)return this.tryAutoHandlePendingInventoryContextSelection(C,this.currentMenuItems,{reason:"context action (generic menu question)"})?0:(console.log(`📋 Menu question detected: "${C}" with ${this.currentMenuItems.length} items`),this.isMultiSelectLootQuestion(C)&&(console.log("Multi-select loot menu detected"),this.isInMultiPickup=!0),this.eventHandler&&this.emit({type:"question",text:C,choices:"",default:"",menuItems:this.currentMenuItems}),console.log("📋 Waiting for menu selection (async)..."),this.waitForQuestionInput());if(this.currentMenuItems.length>0&&!L&&!Q){console.log(`📋 Menu expansion detected with ${this.currentMenuItems.length} items (window ${_})`);let h="Please select an option:";const m=this.currentMenuItems.filter(f=>!f.isCategory);if(console.log(`📋 Found ${m.length} selectable items out of ${this.currentMenuItems.length} total`),m.some(f=>f.text&&typeof f.text=="string"&&(f.text.includes("gold pieces")||f.text.includes("corpse")||f.text.includes("here")))?h="What would you like to pick up?":m.some(f=>f.text&&typeof f.text=="string"&&(f.text.includes("spell")||f.text.includes("magic")))?h="Which spell would you like to cast?":m.some(f=>f.text&&typeof f.text=="string"&&(f.text.includes("wear")||f.text.includes("wield")||f.text.includes("armor")))&&(h="What would you like to use?"),m.length>0)return this.isMultiSelectLootQuestion(h)&&(console.log("Expanded multi-select loot menu detected"),this.isInMultiPickup=!0),this.eventHandler&&(this.currentMenuQuestionText=h,this.emit({type:"question",text:h,choices:"",default:"",menuItems:this.currentMenuItems})),console.log("📋 Waiting for expanded menu selection (async)..."),this.waitForQuestionInput();console.log("📋 Menu has no selectable items - treating as informational")}return 0;case"shim_display_nhwindow":const[E,ue]=t;console.log(`DISPLAY WINDOW [Win ${E}], blocking: ${ue}`);const ce=this.consumeWindowTextBuffer(E);if(ce.some(h=>String(h||"").trim().length>0)&&this.shouldCaptureWindowTextForDialog(E)){const h=ce.map(m=>String(m||"").replace(/\u0000/g,""));if(this.shouldLogWindowTextInsteadOfDialog(h))return console.log(`Routing window ${E} text to message log (${h.length} lines)`),this.emitWindowTextLinesToLog(h,E),0;if(!this.eventHandler)return 0;console.log(`Emitting info dialog for window ${E} with ${h.length} lines`),this.emit({type:"info_menu",title:this.getWindowTextDialogTitle(E),lines:h,window:E,blocking:ue,source:"display_nhwindow"})}return 0;case"shim_display_file":return this.handleShimDisplayFile(t);case"shim_add_menu":const[Ee,J,$e,X,Zt,it,en,tn]=t,he=this.runtimeVersion==="3.7",Z=String((he?t[7]:t[6])||""),ee=it===7,Pe=he?$e:this.nethackModule.getValue($e,"*"),de=!ee&&typeof Pe=="number"&&Pe!==0;let te="",F="",N=null,me=J,G=!1;const Be=this.getNoGlyphValue();if(J){let h=J;if(he){const p=this.nethackModule,v=p==null?void 0:p.HEAPU8,H=p==null?void 0:p.HEAP32,R=J;v&&H&&R>0&&R+4<=v.length?(h=H[R>>2],console.log(`Decoded 3.7 menu glyph: ptr=0x${R.toString(16)} -> glyph=${h}`)):console.log(`Could not decode 3.7 menu glyph from ptr=0x${R.toString(16)}`)}me=h;const m=(a=globalThis.nethackGlobal)==null?void 0:a.helpers,f=he?m==null?void 0:m.mapGlyphInfoHelper:m==null?void 0:m.mapglyphHelper,y=typeof(m==null?void 0:m.tileIndexForGlyph)=="function"?m.tileIndexForGlyph:null;if(typeof h=="number"&&Number.isFinite(h)&&h>=0){if(G=!0,Be!==null&&Math.trunc(h)===Be&&(G=!1),G&&y)try{const p=y(h);typeof p=="number"&&Number.isFinite(p)&&p>=0&&(N=Math.trunc(p))}catch(p){console.log(`Warning: tileIndexForGlyph helper failed for glyph ${h}:`,p)}if(f)try{const p=f(h,0,0,0);if(p&&p.ch!==void 0&&(typeof p.ch=="number"?F=String.fromCharCode(p.ch):F=String(p.ch).charAt(0)),N===null){const v=typeof(p==null?void 0:p.tileidx)=="number"?p.tileidx:p==null?void 0:p.tileIdx;typeof v=="number"&&Number.isFinite(v)&&v>=0&&(N=Math.trunc(v))}}catch(p){console.log(`Warning: Error getting glyph info for menu glyph ${h} (from ptr ${J}):`,p)}}}typeof F=="string"&&F.length>0&&F.trim().length===0&&(G=!1),N===null&&(G=!1),G||(N=null);const pe=!ee&&G;if(ee)console.log(`📋 CATEGORY HEADER: "${Z}" - accelerator code: ${X}`);else{const h=this.isPrintableAccelerator(X);if(de&&h)te=String.fromCharCode(X);else if(de){const m=this.currentMenuItems.filter(y=>!y.isCategory&&y.isSelectable),f="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";te=f[m.length%f.length]}console.log(`📋 MENU ITEM: "${Z}" (key: ${te}) glyph: ${me} -> "${F}" tile: ${N!==null?N:"n/a"} - accelerator code: ${X}`)}return this.currentWindow===Ee&&Z&&this.currentMenuItems.push({text:Z,accelerator:te,originalAccelerator:X,identifier:Pe,window:Ee,glyph:me,glyphChar:F,tileIndex:pe&&N!==null?N:void 0,isTileApplicable:pe,isCategory:ee,isSelectable:de,menuIndex:this.currentMenuItems.length}),this.eventHandler&&this.emit({type:"menu_item",text:Z,accelerator:te,window:Ee,glyph:me,glyphChar:F,tileIndex:pe&&N!==null?N:void 0,isTileApplicable:pe,isCategory:ee,isSelectable:de,menuItems:this.currentMenuItems}),0;case"shim_putstr":const[j,qe,ne]=t;return console.log(`💬 TEXT [Win ${j}]: "${ne}"`),this.appendWindowTextBuffer(j,ne),Number(j)===1&&this.rememberPromptContextMessage(ne),this.shouldCaptureWindowTextForDialog(j)||(this.gameMessages.push({text:ne,window:j,timestamp:Date.now(),attr:qe}),this.gameMessages.length>100&&this.gameMessages.shift(),this.eventHandler&&this.emit({type:"text",text:ne,window:j,attr:qe})),0;case"shim_print_glyph":{const[h,m,f,y,p]=t;let v=y,H=null,R=null,Se=null;if(this.runtimeVersion==="3.7"&&t.length===5){const A=y,P=p,T=this.nethackModule,I=T==null?void 0:T.HEAPU8,D=T==null?void 0:T.HEAP32,Ye=T==null?void 0:T.HEAP16;if(I&&D&&Ye&&A>0&&A+36<=I.length){v=D[A>>2];const gt=D[A+4>>2],yt=D[A+16>>2],Ie=Ye[A+30>>1];Number.isFinite(Ie)&&Ie>=0&&(Se=Math.trunc(Ie)),console.log(`🎨 GLYPH [Win ${h}] at (${m},${f}): ptr=0x${A.toString(16)} glyph=${v} ch=${String.fromCharCode(gt&255)} color=${yt} tileidx=${Ie} extra=0x${P.toString(16)}`)}else console.log(`🎨 GLYPH [Win ${h}] at (${m},${f}): ptr=${A} (0x${A.toString(16)}) extra=${P} (0x${P.toString(16)}) [no HEAP access]`)}else console.log(`🎨 GLYPH [Win ${h}] at (${m},${f}): ${v}`);if(h===3){const A=`${m},${f}`,P=(r=globalThis.nethackGlobal)==null?void 0:r.helpers,T=this.runtimeVersion==="3.7"?P==null?void 0:P.mapGlyphInfoHelper:P==null?void 0:P.mapglyphHelper;if(T)try{const I=T(v,m,f,this.runtimeVersion==="3.7"?2:0);if(I){I.ch!==void 0&&(typeof I.ch=="number"?H=String.fromCharCode(I.ch):H=String(I.ch)),typeof I.color=="number"&&Number.isFinite(I.color)&&(R=I.color);const D=typeof I.tileidx=="number"?I.tileidx:I.tileIdx;typeof D=="number"&&Number.isFinite(D)&&D>=0&&(Se=Math.trunc(D))}}catch(I){console.log(`⚠️ Error getting glyph info for ${v}:`,I)}this.gameMap.set(A,{x:m,y:f,glyph:v,char:H,color:R,tileIndex:Se,timestamp:Date.now()}),this.eventHandler&&this.queueMapGlyphUpdate({type:"map_glyph",x:m,y:f,glyph:v,char:H,color:R,tileIndex:Se,window:h})}return 0}case"shim_player_selection":return console.log("NetHack player selection started"),0;case"shim_raw_print":const[Ge]=t;console.log(`📢 RAW PRINT: "${Ge}"`);const fe=this.normalizePromptContextMessage(Ge);return fe&&this.rememberPromptContextMessage(fe),this.eventHandler&&fe&&this.emit({type:"raw_print",text:fe}),0;case"shim_raw_print_bold":const[Oe]=t;console.log(`RAW PRINT BOLD: "${Oe}"`);const ge=this.normalizePromptContextMessage(Oe);return ge&&this.rememberPromptContextMessage(ge),this.eventHandler&&ge&&this.emit({type:"raw_print",text:ge,bold:!0}),0;case"shim_message_menu":const[st,at,oe]=t;return console.log(`NetHack message_menu: let=${st}, how=${at}, message="${oe}"`),this.eventHandler&&oe&&String(oe).trim()&&(this.rememberPromptContextMessage(String(oe)),this.emit({type:"text",text:String(oe),window:1,attr:0,source:"message_menu"})),0;case"shim_update_inventory":return console.log("NetHack update inventory callback received"),this.eventHandler&&this.emit({type:"inventory_updated_signal"}),0;case"shim_wait_synch":return console.log("NetHack waiting for synchronization"),0;case"shim_nhbell":return console.log("NetHack requested bell"),0;case"shim_select_menu":const[Le,O,ye]=t,He=()=>{const h=this.lastMenuInteractionCancelled;return this.lastMenuInteractionCancelled=!1,h&&this.clearPendingInventoryContextSelection("menu interaction cancelled"),h};let We=0,we=0,ze=0;if(this.nethackModule&&typeof this.nethackModule.getValue=="function"){We=ye;try{we=this.nethackModule.getValue(ye,"*"),we>0&&(ze=this.nethackModule.getValue(we,"*"))}catch(h){console.log("Pointer decode error in shim_select_menu:",h)}}const rt="direct",S=ye;if(console.log(`Menu selection request for window ${Le}, how: ${O}, argPtr: ${ye}, ptrArgSlot=${We}, ptrArgValue=${we}, ptrResolvedValue=${ze}, ptrMode=${rt}, menuListPtrPtr=${S}`),O===2){if(Number.isInteger(this.menuSelectionReadyCount)){const h=this.menuSelectionReadyCount;return this.menuSelectionReadyCount=null,this.writeMenuSelectionResult(S,h),this.menuSelections.clear(),this.isInMultiPickup=!1,this.lastMenuInteractionCancelled=!1,h}if(this.menuSelections.size>0&&!this.isInMultiPickup){const h=this.menuSelections.size;return this.writeMenuSelectionResult(S,h),this.menuSelections.clear(),this.lastMenuInteractionCancelled=!1,h}if(this.isInMultiPickup)return console.log("Multi-pickup menu - waiting for completion (async)..."),this.pendingMenuSelection={resolver:null,menuListPtrPtr:S},new Promise(h=>{this.pendingMenuSelection={resolver:h,menuListPtrPtr:S}})}if(O===1&&this.menuSelections.size>0){const h=Array.from(this.menuSelections.values()),m=h[0];return h.length>1&&console.log(`PICK_ONE had ${h.length} selections; using first item only`),console.log(`Returning single menu selection count: 1 (${m.menuChar} ${m.text})`),this.menuSelections=new Map([[m.menuChar,m]]),this.writeMenuSelectionResult(S,1),this.menuSelections.clear(),this.isInMultiPickup=!1,this.lastMenuInteractionCancelled=!1,1}if(O===1&&Le===4&&this.lastEndedMenuWindow===Le&&!this.lastEndedMenuHadQuestion&&this.lastEndedInventoryMenuKind==="inventory"&&this.menuSelections.size===0&&Array.isArray(this.currentMenuItems)&&this.currentMenuItems.some(h=>h&&!h.isCategory)){if(this.pendingGameOverPossessionsInventoryFlow)return console.log("Suppressing questionless WIN_INVEN PICK_ONE prompt during game-over possessions flow; returning 0"),this.pendingGameOverPossessionsInventoryFlow=!1,this.writeMenuSelectionResult(S,0),this.menuSelections.clear(),this.isInMultiPickup=!1,0;const h=this.consumePendingInventoryContextSelection(this.currentMenuItems);if(h&&this.tryAutoSelectMenuItem(h.menuItem,"context action (questionless PICK_ONE)",h.selectionCount)){const p=Array.from(this.menuSelections.values())[0];return p&&console.log(`Returning single menu selection count (questionless auto): 1 (${p.menuChar} ${p.text})`),this.writeMenuSelectionResult(S,1),this.menuSelections.clear(),this.isInMultiPickup=!1,this.lastMenuInteractionCancelled=!1,1}console.log("PICK_ONE for questionless WIN_INVEN menu - waiting for async selection..."),this.eventHandler&&(this.currentMenuQuestionText="Choose an inventory item:",this.emit({type:"question",text:"Choose an inventory item:",choices:"",default:"",menuItems:this.currentMenuItems}));const m=this.waitForQuestionInput(),f=()=>{if(this.menuSelections.size>0){const y=Array.from(this.menuSelections.values()),p=y[0];return y.length>1&&console.log(`PICK_ONE had ${y.length} selections after async wait; using first item only`),console.log(`Returning single menu selection count after async wait: 1 (${p.menuChar} ${p.text})`),this.menuSelections=new Map([[p.menuChar,p]]),this.writeMenuSelectionResult(S,1),this.menuSelections.clear(),this.isInMultiPickup=!1,this.lastMenuInteractionCancelled=!1,1}return He()?(console.log("Questionless WIN_INVEN PICK_ONE cancelled; returning -1"),this.writeMenuSelectionResult(S,-1),this.menuSelections.clear(),this.isInMultiPickup=!1,-1):(console.log("Questionless WIN_INVEN PICK_ONE completed with no selection; returning 0"),this.writeMenuSelectionResult(S,0),this.menuSelections.clear(),this.isInMultiPickup=!1,0)};return m&&typeof m.then=="function"?m.then(()=>f()):f()}if(O===1)return He()?(console.log("PICK_ONE cancelled; returning -1"),this.writeMenuSelectionResult(S,-1),this.menuSelections.clear(),this.isInMultiPickup=!1,-1):(console.log("PICK_ONE requested with no selection; returning 0"),this.writeMenuSelectionResult(S,0),this.menuSelections.clear(),this.isInMultiPickup=!1,0);if(O===2&&this.menuSelections.size>0){const h=Array.from(this.menuSelections.values());console.log(`Returning ${this.menuSelections.size} selected items:`,h.map(f=>`${f.menuChar}:${f.text}`));const m=this.menuSelections.size;return this.writeMenuSelectionResult(S,m),this.menuSelections.clear(),this.isInMultiPickup=!1,this.lastMenuInteractionCancelled=!1,m}return O===2&&He()?(console.log("PICK_ANY cancelled; returning -1"),this.writeMenuSelectionResult(S,-1),this.menuSelections.clear(),this.isInMultiPickup=!1,-1):(console.log("Returning 0 (no selection)"),this.writeMenuSelectionResult(S,0),this.menuSelections.clear(),0);case"shim_askname":this.nameRequestDebugCounter+=1;const V=this.nameRequestDebugCounter,be=this.normalizeCharacterNameValue((u=(c=this.startupOptions)==null?void 0:c.characterCreation)==null?void 0:u.name);console.log("[NAME_DEBUG] shim_askname entered",{callId:V,args:t,pendingTextResponses:this.pendingTextResponses.length,configuredName:be,awaitingQuestionInput:this.awaitingQuestionInput,activeInputRequestType:((d=this.activeInputRequest)==null?void 0:d.kind)||null}),this.eventHandler&&this.emit({type:"name_request",text:"What is your name?",maxLength:30,source:"askname",callId:V,pendingTextResponses:this.pendingTextResponses.length});let $="";if(this.pendingTextResponses.length>0){const h=this.pendingTextResponses.length,m=this.normalizeCharacterNameValue(String(this.pendingTextResponses.shift()||""));console.log("[NAME_DEBUG] shim_askname consumed queued input",{callId:V,name:m,queueBefore:h,queueAfter:this.pendingTextResponses.length}),m.length>0&&($=m)}return!$&&be.length>0&&(console.log("[NAME_DEBUG] shim_askname using configured name",{callId:V,configuredName:be}),$=be),$||(console.log("[NAME_DEBUG] shim_askname falling back to default Web_user",{callId:V}),$="Web_user"),this.setRuntimePlayerName($)||console.log("[NAME_DEBUG] shim_askname could not write player name to runtime globals",{callId:V,resolvedName:$}),$;case"shim_mark_synch":return console.log("NetHack marking synchronization"),0;case"shim_cliparound":const[ie,se]=t;return console.log(`🎯 Cliparound request for position (${ie}, ${se}) - updating player position`),this.positionInputActive||this.isFarLookPositionRequest()?(console.log(`🎯 Cliparound in position-input mode; routing to cursor at (${ie}, ${se})`),this.emitPositionCursor(null,ie,se,"cliparound"),0):({...this.playerPosition},this.playerPosition={x:ie,y:se},this.eventHandler&&this.emit({type:"player_position",x:ie,y:se}),0);case"shim_clear_nhwindow":const[ke]=t;return console.log(`🗑️ Clearing window ${ke}`),this.resetWindowTextBuffer(ke),(ke===2||ke===3)&&(console.log("Map window cleared - clearing 3D scene"),this.emit({type:"clear_scene"})),0;case"shim_update_positionbar":return 0;case"shim_getmsghistory":const[Ue]=t;return console.log(`Getting message history, init: ${Ue}`),Ue&&(this.messageHistorySnapshot=[],this.messageHistorySnapshotIndex=0),"";case"shim_putmsghistory":const[ve,je]=t;if(console.log(`Putting message history: "${ve}", restoring: ${je}`),typeof ve=="string"&&ve.trim()){const h=ve.replace(/\u0000/g,"").trim();h&&(this.rememberPromptContextMessage(h),this.gameMessages.push({text:h,window:1,timestamp:Date.now(),attr:0}),this.gameMessages.length>100&&this.gameMessages.shift())}else je&&(this.messageHistorySnapshot=[],this.messageHistorySnapshotIndex=0);return 0;case"shim_doprev_message":if(console.log("Handling previous-message request"),this.eventHandler){const h=this.getRecallableMessageHistoryLines();h.length>0&&(console.log(`Emitting info_menu for previous-message request (${h.length} lines)`),this.emit({type:"info_menu",title:"Message History",lines:h,source:"doprev_message"}))}return 0;case"shim_exit_nhwindows":return console.log("Exiting NetHack windows"),0;case"shim_suspend_nhwindows":return console.log("Suspending NetHack windows"),0;case"shim_resume_nhwindows":return console.log("Resuming NetHack windows"),0;case"shim_destroy_nhwindow":const[Ve]=t;return console.log(`🗑️ Destroying window ${Ve}`),this.resetWindowTextBuffer(Ve),0;case"shim_curs":const[ae,xe,Me]=t;return console.log(`🖱️ Setting cursor for window ${ae} to (${xe}, ${Me})`),this.positionInputActive||this.isFarLookPositionRequest()?this.emitPositionCursor(ae,xe,Me,"curs"):this.eventHandler&&Number.isFinite(xe)&&Number.isFinite(Me)&&(ae===2||ae===3)&&this.emit({type:"map_cursor",x:xe,y:Me,window:ae,source:"curs"}),0;case"shim_status_update":const[re,Ke,lt,ut,ct,ht]=t,W=this.getStatusFieldName(re);if(W==="BL_FLUSH"||W==="BL_RESET"||W==="BL_CHARACTERISTICS")return this.flushPendingStatusUpdates(W),0;const K=this.decodeStatusValue(W,Ke),Qe={type:"status_update",field:re,fieldName:W,value:K.value,valueType:K.valueType,ptrToArg:Ke,usedFallback:K.usedFallback,chg:lt,percent:ut,color:ct,colormask:ht,levelIdentity:this.resolveRuntimeLevelIdentity()};return this.statusPending.set(re,Qe),this.latestStatusUpdates.set(re,Qe),console.log(`Queued status update ${W} (${re}) => ${K.value} [type=${K.valueType}, fallback=${K.usedFallback}]`),0;case"shim_status_enablefield":const[dt,mt,pt,ft]=t;return console.log("Status field enable callback:",dt,mt,pt,ft),0;case"shim_number_pad":const[Re]=t;return this.numberPadModeEnabled=Number(Re)!==0,console.log(`Number pad mode callback: ${Re} (enabled=${this.numberPadModeEnabled})`),this.eventHandler&&this.emit({type:"number_pad_mode",enabled:this.numberPadModeEnabled,mode:Re}),0;case"shim_delay_output":return this.beginClickMoveBlockWindow(),this.travelSpeedDelayMs<=0?0:(console.log(`NetHack requesting output delay for travel (${this.travelSpeedDelayMs}ms).`),new Promise(h=>setTimeout(h,this.travelSpeedDelayMs)));case"shim_change_color":return 0;case"shim_change_background":return 0;case"set_shim_font_name":return 0;case"shim_get_color_string":return"";case"shim_start_screen":return console.log("NetHack start_screen (no-op)"),0;case"shim_end_screen":return console.log("NetHack end_screen (no-op)"),0;case"shim_outrip":return console.log("NetHack outrip (tombstone)",t),this.eventHandler&&this.emit({type:"outrip",args:t}),0;case"shim_preference_update":return 0;case"shim_player_selection_cb":return!0;default:return console.log(`Unknown callback: ${e}`,t),0}}flushPendingStatusUpdates(e="flush"){if(this.statusPending.size===0)return;const t=Array.from(this.statusPending.entries()).sort((n,o)=>n[0]-o[0]).map(([,n])=>n);this.statusPending.clear(),console.log(`Flushing ${t.length} pending status updates (reason=${e})`);for(const n of t)n&&typeof n.field=="number"&&this.latestStatusUpdates.set(n.field,n),this.eventHandler&&this.emit(n)}emit(e){typeof this.eventHandler=="function"&&this.eventHandler(e)}}const B=globalThis,Kt=(...l)=>{};B.__NH3D_ORIGINAL_CONSOLE_LOG__||(B.__NH3D_ORIGINAL_CONSOLE_LOG__=console.log.bind(console));typeof B.__NH3D_LOGGING_ENABLED__!="boolean"&&(B.__NH3D_LOGGING_ENABLED__=!1);function ot(){const l=B.__NH3D_ORIGINAL_CONSOLE_LOG__||console.log.bind(console);console.log=B.__NH3D_LOGGING_ENABLED__?l:Kt}function Qt(){return!!B.__NH3D_LOGGING_ENABLED__}function Ze(l){return B.__NH3D_LOGGING_ENABLED__=!!l,ot(),Qt()}ot();let U=null,et=!1,tt=!1,nt=!1;function Yt(l){const e=String(l||"").trim();return e.length<2||e.length>30||e.startsWith("__")||e.includes(":")?!1:/^[A-Za-z][A-Za-z0-9 _'-]*$/.test(e)}function _e(l){if(l.type==="runtime_event"&&l.event.type==="runtime_terminated"){const e=()=>{self.postMessage(l)};if(U&&U.nethackModule&&U.nethackModule.FS)try{console.log("Worker: syncing files to IndexedDB before terminating..."),U.nethackModule.FS.syncfs(!1,t=>{t?console.error("Worker IDBFS sync error:",t):console.log("Worker: file sync complete."),e()});return}catch(t){console.error("Worker IDBFS sync exception:",t)}}self.postMessage(l)}function Te(l){if(!l||typeof l!="object")return null;const e=l;return typeof e.status=="number"&&Number.isFinite(e.status)?e.status:null}function Ce(l){if(typeof l=="string")return l;if(!l||typeof l!="object")return String(l??"");const e=l;if(typeof e.message=="string"&&e.message.trim())return e.message;if(typeof e.reason=="string"&&e.reason.trim())return e.reason;if(e.error&&typeof e.error=="object"){const t=e.error;if(typeof t.message=="string"&&t.message.trim())return t.message;if(typeof t.reason=="string"&&t.reason.trim())return t.reason}return String(l)}function Ne(l,e){if(e===0)return!0;const t=String(l||"").toLowerCase();return t?t.includes("exitstatus")&&t.includes("exit(0)")||t.includes("program terminated with exit(0)")||t.includes("asyncify wakeup failed"):!1}function Ae(l,e=0){tt||(tt=!0,_e({type:"runtime_event",event:{type:"runtime_terminated",reason:l||"Program terminated with exit(0)",exitCode:e??0}}))}function Fe(l){_e({type:"runtime_error",error:l||"Runtime worker error"})}function Jt(){if(nt)return;nt=!0;const l=console.error.bind(console);console.error=(...e)=>{try{const t=e[0],n=e[1],o=typeof t=="string"?t.toLowerCase():"",s=Ce(n).toLowerCase(),i=Te(n);if(o.includes("asyncify wakeup failed")&&Ne(s,i)){Ae(Ce(n)||"Program terminated with exit(0)",i??0);return}}catch{}l(...e)}}function z(l){return U||(Jt(),U=new Vt(e=>{_e({type:"runtime_event",event:e})},l??null)),U}self.addEventListener("error",l=>{const e=Te(l.error),t=Ce(l.error??l.message);if(Ne(t,e)){Ae(t,e??0),l.preventDefault();return}Fe(t)});self.addEventListener("unhandledrejection",l=>{const e=Te(l.reason),t=Ce(l.reason);if(Ne(t,e)){Ae(t,e??0),l.preventDefault();return}Fe(t)});self.onmessage=async l=>{var e;try{const t=l.data;switch(t.type){case"start":Ze(!!((e=t.startupOptions)!=null&&e.loggingEnabled));const n=z(t.startupOptions);et||(await n.start(),et=!0),_e({type:"runtime_ready"});return;case"send_input":Yt(t.input)&&console.log("[NAME_DEBUG] Worker received send_input(name-like)",{input:t.input}),z().sendInput(t.input);return;case"send_input_sequence":z().sendInputSequence(t.inputs);return;case"send_mouse_input":z().sendMouseInput(t.x,t.y,t.button);return;case"request_tile_update":z().requestTileUpdate(t.x,t.y);return;case"request_area_update":z().requestAreaUpdate(t.centerX,t.centerY,t.radius);return;case"request_runtime_globals_snapshot":z().requestRuntimeGlobalsSnapshot();return;case"set_logging":Ze(!!t.enabled);return;default:return}}catch(t){const n=Te(t),o=t instanceof Error?t.message:String(t);if(Ne(o,n)){Ae(o,n??0);return}Fe(o)}};var an=Object.freeze({__proto__:null});export{an as _};
