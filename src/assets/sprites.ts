/**
 * Storybook Dungeon pixel-art sprites for the Pixel Dungeon v2 browser rebuild.
 * Generated from original AI-assisted sprite sheets (art-src/) via
 * scripts/build_sprites.py: magenta-keyed, cropped, downscaled to 16x16 and
 * palette-quantized. All art is original to this project — nothing is copied
 * from any game. Floor/wall/secret-door stay on the tintable gray ramp
 * (F,f,W,w) so REGION_TINTS renders the 5 regional tilesets.
 *
 * scroll_upgrade is hand-authored in the same 16x16 char-art idiom (a
 * parchment roll with a golden up-arrow rune, reusing the shared palette)
 * rather than pipeline-generated; see HAND_AUTHORED in build_sprites.py.
 *
 * Format: each sprite is 16 strings of 16 chars; each char maps to PALETTE.
 * '.' is transparent.
 */
export const ART_PX = 16;

export const PALETTE: Record<string, string> = {
  ".": "transparent", // transparent
  "k": "#2b2226", // warm dark outline
  "F": "#6e7484", // floor base
  "f": "#5b6170", // floor dark speckle
  "W": "#3d4354", // wall face
  "w": "#565e78", // wall top highlight
  "H": "#ffffff", // glass sparkle
  "y": "#f2c14e", // gold
  "a": "#5d2d1b", // quantized
  "b": "#842e12", // quantized
  "h": "#97734b", // quantized
  "i": "#877f74", // quantized
  "j": "#4f4242", // quantized
  "l": "#1365a7", // quantized
  "m": "#525a2b", // quantized
  "n": "#1778a6", // quantized
  "p": "#4d6b3f", // quantized
  "q": "#a0a7ac", // quantized
  "r": "#0e83c3", // quantized
  "t": "#b1884a", // quantized
  "x": "#a69f7f", // quantized
  "A": "#e8d3ae", // quantized
  "C": "#e39b4f", // quantized
  "E": "#a03413", // quantized
  "I": "#f7bc78", // quantized
  "J": "#c77a39", // quantized
  "K": "#deb47b", // quantized
  "L": "#578788", // quantized
  "M": "#a5ab45", // quantized
  "Q": "#488f2c", // quantized
  "V": "#b75034", // quantized
  "X": "#4f5267", // quantized
  "Y": "#fdf6e3", // quantized
  "Z": "#50933e", // quantized
  "0": "#d5c6b1", // quantized
  "1": "#855539", // quantized
  "2": "#e31c0a", // quantized
  "3": "#a48679", // quantized
  "D": "#8a5a2b", // wood
  "o": "#e8862e", // flame orange
  "z": "#120e16", // chasm dark
};

export const SPRITES: Record<string, string[]> = {
  hero: [
    '........JVt.....',
    '........JVVV....',
    '.qq.....31VVE...',
    '.qq....qqiaVb...',
    '..0X.iqqqqiEV...',
    '..0X.i0iqiijba..',
    '..3ijiqiiiij....',
    '.jm1jjihX1Xj....',
    '..kK1ixIxxLL....',
    '...1jX3KK3ij....',
    '.....jLXLLiXj...',
    '......LLLXpLj...',
    '......pmajx1....',
    '.....jLLLXj.....',
    '.....aak.j1a....',
    '.....aa..a1a....',
  ],

  hero_warrior: [
    '........JVt.....',
    '........JVVV....',
    '.qq.....31VVE...',
    '.qq....qqiaVb...',
    '..0X.iqqqqiEV...',
    '..0X.i0iqiijba..',
    '..3ijiqiiiij....',
    '.jm1jjihX1Xj....',
    '..kK1ixIxxLL....',
    '...1jX3KK3ij....',
    '.....jLXLLiXj...',
    '......LLLXpLj...',
    '......pmajx1....',
    '.....jLLLXj.....',
    '.....aak.j1a....',
    '.....aa..a1a....',
  ],

  floor0: [
    'FFFFFFFFFFFFFFFF',
    'FffFFFFFFFFfffZF',
    'FffFFFFFFFFFffFF',
    'FFFFFFFFFFFFFFFf',
    'FFFffFFFFFFFFFFf',
    'FFFffFFFFFFfffFF',
    'FFFFFFFFFFFFFFFF',
    'FFFFZFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFF',
    'FFffFFFFFFFFFffF',
    'FFffFFFFFFFFFffF',
    'FFFFFFFFFFFFFFFF',
    'FffFFFFFFFffFFFF',
    'FffFFFFFFFffFpQF',
    'FFFFFFFFFFFFFFFF',
  ],

  floor1: [
    'FFFFFFFFFFFFFFFF',
    'FZfffFFFFFFFFffF',
    'FFffFFFFFFFFFffF',
    'fFFFFFFFFFFFFFFF',
    'fFFFFFFFFFFffFFF',
    'FFfffFFFFFFffFFF',
    'FFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFZFFFF',
    'FFFFFFFFFFFFFFFF',
    'FFFFFFFFFFFFFFFF',
    'FffFFFFFFFFFffFF',
    'FffFFFFFFFFFffFF',
    'FFFFFFFFFFFFFFFF',
    'FFFFffFFFFFFFffF',
    'FQpFffFFFFFFFffF',
    'FFFFFFFFFFFFFFFF',
  ],

  wall: [
    'fwwwwwwwwwwwwwww',
    'pwwwwwwwffwwfwww',
    'wwwwwwffffwwZQww',
    'wwfQfwZfwwwwwwww',
    'wwwwwwwwwwwwwwww',
    'WwwwwwwwwwwwwwwW',
    'QpjWpWjWWppWpWWW',
    'WWmWWWQWWWpWWpWW',
    'WWWWWWpWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
  ],

  door: [
    'hiZQZQQQQQQZQZii',
    'phxpmmppmppmpmti',
    'QQp111111111jQQQ',
    'ZQp111a11111jQQQ',
    'p1aj11hJJJJ111hQ',
    'phjjjjJJJJJ111hp',
    'pmma1ttJtJJ11pmZ',
    'ppp1JttJtJj1mp1p',
    'pmp1JttJt1jjjphp',
    'phj1JJtJtJ1111hp',
    'p1jj11hJJJJ111hp',
    'm1iajjVJVVV11q1m',
    'm1Zm111V1111mi1j',
    '1jppmjj1jjjphL11',
    '1jQQQttt33pQhp11',
    '1jQQpt3htthQQp11',
  ],

  door_locked: [
    'MZiQQQQQQQQQQZii',
    'phxpmppppppmpmhL',
    'QQQj11111111jQQQ',
    'QQQ1a111111aapQQ',
    'Q11ja111111a111Q',
    'ph1jjjjjjjjj11hQ',
    'Qj1j111jj1111pmQ',
    'ppQ11h1XX1h11Q1p',
    'p1p11h1MJ1h11php',
    'phj11h1111h111hp',
    'p11jjjjjjjjj111p',
    'j1ijajjjjjjaax1m',
    'jQhpa1111V1amihj',
    '1jpZpjjjjjjQtiX1',
    '1jQQQh33t3hQmpj1',
    'j1QQZ333h3hZQQ11',
  ],

  door_secret: [
    'wwwwwwwwwwwwwwww',
    'pwwwwwwwwfwwwWww',
    'wwwwwwwfppwwQQWw',
    'wwfZffQfwwwwwwww',
    'wwwwwwwwwwwwwwww',
    'WwwwwwwwwwwwwwwW',
    'ppjWpkWWWpjWpWWW',
    'WWmWWkQWWmQWppWW',
    'WWWWWkpWWWWWWWWW',
    'WWWWWkWWWWWWWWWW',
    'WWWWWkWWWWWWWWWW',
    'WWWWWkWWWWWWWWWW',
    'WWWWWkWWWWWWWWWW',
    'WWWWWkWWWWWWWWWW',
    'WWWWWkWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
  ],

  water: [
    'lHrrrrrHrrrrrrrr',
    'HllrrrHHHrrllllr',
    'llllllrHrHlllrrr',
    'rrrrrrrrrrHrrrll',
    'rrrrrrrrrrHlllll',
    'llrrrrrrrrHlllll',
    'lrrrrrrrlrrlrlrr',
    'rllllrrrrllllrrr',
    'lllllllrrrrrrrrl',
    'rrrnllnrrrrrrrll',
    'rrrlllllllllrrrr',
    'lllllllHlllrrrrH',
    'llrrllrHrrrrrrrH',
    'lllrrrrrHrrrlrHl',
    'lllrlrrrHHlllHHl',
    'lllllrrrllHHHlll',
  ],

  grass: [
    'ZZQQfZffFffQQfff',
    'ppQQfpFFffQQQQFF',
    'ffQWffFfppQmQQff',
    'pQQfFFFffffffffQ',
    'QQQQFfFZZffFFfQQ',
    'QQQfQfZQQQQQfppQ',
    'ppfpQfQQQQQQZZQp',
    'QfZfffQQQpQQQQQQ',
    'QfpZZfpQZFppQQQQ',
    'ZZZQfZffFffQQfff',
    'ppQQfpFFFpQQQZFF',
    'ffQWffFfppQmQQfZ',
    'QQQfFFFffffffffQ',
    'QQQQffFfZffFFfQQ',
    'QQQfQffQQQQQfpQQ',
    'fpfZpfQQQQQQZfQp',
  ],

  chasm: [
    '.aakkkabbbbkabbb',
    '.bbkkkaaaaabbaak',
    '.bbbkkkkkkkbakka',
    '.bbakkkkkkkkkkab',
    '.akkkkkkkkkkkabb',
    '.kkkkkkkkkkkkaab',
    '.abkkkkkkkkkkkab',
    '.bbbkkkkkkkkkkka',
    '.bbkkkkkkkkkkkkk',
    '.baakkkkkkkkkkkb',
    '.bakkkkkkkkkkkkb',
    '.bkkkkkkkkkkkabb',
    '.bbkkkkkkkkkkkba',
    '.bbakbkkkkkabbba',
    '.aabbbkkkkkbbbbb',
    '.baabbbbbakabbbb',
  ],

  stairs_up: [
    'YYKYYYYYYYYYYKYY',
    'II3YYYYYYYYYYtII',
    'II3YYYYYYYYYYtII',
    'CC1KKKKIKKIIK1CC',
    'CCbEVVVVVVVVEbCC',
    'CCVIIIIIIIIIIVCC',
    'CCbJJJJJJJJJJbCC',
    'JJkbbbbbbbbbbkJJ',
    'JJVCCCCCCCCCCVJJ',
    'JJbVVJJJJJJJVbJJ',
    'VEabbEEEEEEbbaEV',
    'VEVJJJJJJJJJJVEV',
    'VEbEEEEEEEEEEbVV',
    'EbabbbbbbbbbbabE',
    'bbVVVVVVVVVVVVbb',
    'bbVVVVVVVVVVVVbb',
  ],

  stairs_down: [
    'CCEIIIIIIIIIIEJC',
    'CCkbbbbbbbbbbkCC',
    'CJbCIIIIIIIICbJC',
    'CJbCCCCCCCCCCbJC',
    'CJkbEEEEEEEEbkJC',
    'CJEIIIIIIIIIIEJC',
    'CJbJCCCCCCCCJbJC',
    'CJaEVVVVVVVVEaJC',
    'CJEIIIIIIIIIIEJC',
    'JVbJJJJJJJJJJbVJ',
    'VVabEbEbbEbEbaVJ',
    'JVbVVEbaabEVJbVJ',
    'EbEEkkkkkkkkVEbE',
    'baEbkkkkkkkkbEab',
    'VVJbkkkkkkkkkEVV',
    'VJVakkkkkkkkaVVJ',
  ],

  trap_revealed: [
    'bbbbbbbbbbbbbbbb',
    'Eb222222222222bE',
    'b2bbbE22222bbb2E',
    'b2b22E2222E22b2E',
    'b2aEEbEEEEbEEa2b',
    'b2E010iq33qi0E2E',
    'b2bxaijijjia3b2E',
    'b2bkkkkkkkkkkk2E',
    'b2bjkjk1aajkhb2E',
    'b2E0j0iq3iq10E2E',
    'b2bhbh111111hb2b',
    'E2b22b2222E22b2E',
    'b2b22E2222E22b2E',
    'b2bbbE22222bbb2E',
    'Eb222222222222bE',
    'bbbbbbbbbbbbbbbb',
  ],

  well: [
    '......bE........',
    '.....bbEbb......',
    '...bbbbEbbb.....',
    '..bbbbbabbbb....',
    '..bbbabbbabba...',
    '..bka1b1bbkab...',
    '..aa11aaah1b....',
    '.11bakkkkaab1...',
    '.1bakkkkkkkb1...',
    '.11akkkkkkk1h...',
    '.a11kkkkkka11...',
    '.khh1jkkk11hak..',
    '.aa1hhhh1hhaa...',
    '..aaaa1ha1aaa...',
    '..jaabaaaaaa....',
    '....aaaaaa......',
  ],

  chest: [
    '................',
    '...haaaaaa..1a..',
    '.1C1httttt1Ct11.',
    '.thhtttth1tt1a1.',
    '.C111111h1Chaaaa',
    '1t1hh111h1C1aaaa',
    'hJtthhh111t111aa',
    'j111kka1hh1aa11a',
    '1hhhtCthtth11aaa',
    '1h11JmJa111aaaaa',
    'mt111JJ111t1aam.',
    '.t111a1111Mmaam.',
    '.11111111MMmama.',
    '.a1hhh11ZZZmaa..',
    '.....aaaa1aa....',
    '................',
  ],

  mob_rat: [
    '................',
    '.1i.............',
    'j..i............',
    '..ih............',
    '.3i.............',
    'i3..Xii33X..33..',
    'h3.i33iKKijiiK..',
    '.3iiiiiK3ixxxi..',
    '..iiiiiiii1ixX..',
    '.jiiiiiiiih1i1..',
    '.iiijiiiXiiix3X.',
    '33j..jX3ijjii1..',
    '.j.....j33X.i1..',
    '.........1......',
    '................',
    '................',
  ],

  mob_gnoll: [
    '..m........m....',
    '..mZp....pZm....',
    '...pMpMMpZp.....',
    '...QZMMMMpQ.....',
    '...aQpZZ1Qa.....',
    '...pMhpmhMm.....',
    '...mpZZZppm111a.',
    '..Z1mppipmh1111.',
    '.ZMmhammpmh11i1a',
    'pMmaa1mZMph1h0ia',
    'ZMpjm11mpm111Xja',
    'pZm11ama1a11111a',
    '..amamZpaam1aaa.',
    '..mMmmmmmZMaaa..',
    '..jQm....mQ.....',
    '..mZm....mZm....',
  ],

  mob_crab: [
    '................',
    '................',
    '.b.1..1b.1b.E.a.',
    'VV.VbbjbbjabV.VE',
    'EVbVb.ba.a.bVbVE',
    'bVVEa.bk.a..EVVb',
    '.bba.VVVVVE.abb.',
    '...bEKCVVVVEb...',
    '...aVJEVVbVVb...',
    '..EbVVVVEVVVEba.',
    '.bbEbVVVVVVEbEb.',
    '.aEaVaVVVVEVbab.',
    '..bEa..bb...Eka.',
    '....a.......a...',
    '................',
    '................',
  ],

  mob_swarm: [
    '........1mm.....',
    '.......mmmja....',
    '......jja1maa...',
    '......jjaajjak..',
    '...1maaajaaaa...',
    '..1jm1kaaakkk...',
    '.m1mmjjkkkaakk..',
    'jajajajaaj11hm..',
    'aaaajjjajjmmj1m.',
    'aaaakkkj1jam1jaa',
    'kkkkkkkXjjjjmjaa',
    'kkkakkkjjjjjaaaa',
    '..ka...akaakkaaa',
    '........kkkakakk',
    '........k.kkakkk',
    '...........a....',
  ],

  mob_skeleton: [
    '......xqxi......',
    '.....0YYAAx.....',
    '....3AA0AA0.....',
    '....i0xjXxjj....',
    '....13xLxiLj....',
    '....ijji0xi.....',
    '..3hiiiiXjX.ijX.',
    '..X3iiiiiXiXXjj.',
    'aaiiijjxij.3j...',
    '.jiijajjj.......',
    '..jj11iX1.......',
    '...ajj1iii......',
    '...jjkXXiiii....',
    '...i3...j11ii...',
    '..ji....jXjjX...',
    '..jjj...........',
  ],

  mob_thief: [
    '................',
    '........LLXL....',
    '......XXXXXXX...',
    '.......XXXXXXX..',
    '.......jXXXjkkk.',
    '......jXXjakkkk.',
    '.....jkjjkmaaak.',
    '..kkXXXjjkkkkkk.',
    'kXXXjjjjjjkkkk..',
    'jXXjjjjjjjjkjjj.',
    'XXjjjjajjjjkjjjk',
    'XjkjjXjaa1ajjjkj',
    'jkkkXqjjXjjXXkjk',
    '.k..iXXXj.kjk..k',
    '.....kkk........',
    '................',
  ],

  mob_goo: [
    '................',
    '..k..kkkkk......',
    '...kkMMMZZkk.k..',
    '..kMKKMMZZZZk...',
    '..kMMZZMZZZQk...',
    '.kMMZhJZZQQJmk.k',
    '.kMMZCCJmQ1C1Zkk',
    'kMZZZVJJQQ1Jmk..',
    'QZZZZQmQZZQQQZk.',
    'mQZZZZZQmmpQZQk.',
    'mQQQQZZZQQZZQk..',
    'ZQQQZZZZZZQQQQk.',
    'kkQQZQQQQQQQQQkk',
    '..kZZQkkkkkZQk..',
    '..kkkk.....kk...',
    '................',
  ],

  shortsword: [
    '.............kij',
    '...........j0A0X',
    '..........j0Y0qj',
    '.........j0Y0qq.',
    '........j0Y0qqj.',
    '.......j0Y0qqj..',
    '......j0Y0qqj...',
    '..jChj0Y0qqj....',
    '..jtKh00qqj.....',
    '....hChqqj......',
    '...aaJC1j.......',
    '..aaaahC1.......',
    '.jaaaa.tC.......',
    'XYhaa..jj.......',
    'Xqqj............',
    '.XX.............',
  ],

  dart: [
    '...............j',
    '..............0.',
    '............XX..',
    '...........h0X..',
    '..........hC1...',
    '.........hC1....',
    '........jt1.....',
    '.......jtj......',
    '......jtj.......',
    '...LLXhj........',
    '..LLL1X.........',
    '.LLL1LL.........',
    'XLXjLLL.........',
    '...XLX..........',
    '...XL...........',
    '...X............',
  ],

  potion_red: [
    '......1111......',
    '......1th1......',
    '.....Lihhin.....',
    '.....Lrrrrn.....',
    '.....jrhhrj.....',
    '.....Lrrrrn.....',
    '....Lq3VVhLr....',
    '...LxIIVVVVir...',
    '..XqIIIVVVVVLX..',
    '..LVKICVVVVCVn..',
    '..LVVVVVVVJAVn..',
    '..LVVJVVVVVVVn..',
    '..XLVVJVVVVELX..',
    '...nLVVVVVVLn...',
    '....nLVEEVLn....',
    '.....jllllj.....',
  ],

  potion_strength: [
    '......j11j......',
    '......ahha......',
    '.....XLiiLX.....',
    '.....XqqiLX.....',
    '.....krLLrk.....',
    '......rLirk.....',
    '......qCCxk.....',
    '......xIAq......',
    '......xCCik.....',
    '......xJCik.....',
    '......xJJik.....',
    '......xCJik.....',
    '......xIJik.....',
    '......xJJik.....',
    '......qJJL......',
    '......XXXX......',
  ],

  ration: [
    '......11........',
    '...11tKCtxh.....',
    '...KAAKtKKCaaZm.',
    '...3A0AA0t1mmm..',
    '....htCCthZjpZ..',
    '....111h111Zm...',
    '...11111111m....',
    '..xAh1b111tC1...',
    '.xAAt1t1K1KAC1..',
    'hAA01tKxtxhAKta.',
    'hAAxtAAA0A10KCa.',
    'hAAt3AAAAAhtKCa.',
    '1AA1KAAAAAthCCa.',
    '.hK1KAAAKKthC1..',
    '..h1tCCCCC1h1...',
    '....111111a.....',
  ],

  scroll: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '13h1..aab...hhh.',
    'KAAAA0EEbE3AAAt1',
    'KAAAAxEEbV3AAAt1',
    'KAAKKtEbEtKAAKt1',
    'tCCCCtbEEtCCCCt1',
    '111a..abb...111.',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],

  scroll_upgrade: [
    '................',
    '................',
    '................',
    '......yy........',
    '.....kyyk.......',
    '....kyyyyk......',
    '..kkkkyykkkk....',
    '.k00ttkyyktt00k.',
    'k000ttyyktt0000k',
    'k000ttyyktt0000k',
    'k00ttkyyktt0000k',
    '.k00ttkyyktt00k.',
    '..kkkkyykkkk....',
    '......yy........',
    '......kk........',
    '................',
  ],

  armor_cloth: [
    '................',
    '...jjja...jj1j..',
    '.1KKxtj111ahttha',
    'jhxKKhh1aa1thtKj',
    'jjhth13x3hxxh1hj',
    'kjj1jxKKh1xxKjj.',
    '.kjkhxtKhj3ttj..',
    '..j13KtKxhKxK1..',
    '..1h3KtK1mh3hX..',
    '..jhhthth1h1hj..',
    '..ahtKtKxhKt3j..',
    '..k11hhxma11Xk..',
    '...hhKhxt1thij..',
    '...j1hhth111X...',
    '.....jjjjjjz....',
    '................',
  ],

  gold: [
    '................',
    '................',
    '................',
    '......1JJ.......',
    '......hJJb......',
    '....1yoaVoD.....',
    '...hCDDyhDJoa...',
    '..hDDayyDDDDDD..',
    'tyoDCybDDDDJak..',
    'bbaDytbyytJoDJyD',
    '.DyombDDDbamDab.',
    '.DJD..JyJ..CoD..',
    '......DJD.......',
    '................',
    '................',
    '................',
  ],

  // Stage 0 (exact copy): high-grass drops. Minimal hand art until the
  // sprite pass extracts the originals (ItemSpriteSheet.DEWDROP / seeds).
  dewdrop: [
    '................',
    '................',
    '................',
    '................',
    '......11........',
    '.....1rr1.......',
    '.....rHHr.......',
    '.....rHrr.......',
    '......rrr.......',
    '.......r........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],

  seed: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......bb........',
    '.....bYYb.......',
    '.....bYYb.......',
    '......bb........',
    '.......b........',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],

  key_iron: [
    '................',
    '...XXj..........',
    '.qijjXj.........',
    '.qX..XX.........',
    'XX...XX.........',
    'jX..XXk.........',
    '.XXXXXXk........',
    '.kjjkkXX........',
    '......kXX.......',
    '.......kXX...X..',
    '........kXX.jX..',
    '.........kXiXXXj',
    '..........kXXXj.',
    '...........kXik.',
    '............kj..',
    '................',
  ],

  // Stage 0 (exact copy): minimal hand art until the sprite pass extracts
  // the original ItemSpriteSheet.GOLDEN_KEY.
  key_gold: [
    '................',
    '...YYj..........',
    '.qiyyYj.........',
    '.qY..YY.........',
    'YY...YY.........',
    'jY..YYk.........',
    '.YYYYYYk........',
    '.kjjkkYY........',
    '......kYY.......',
    '.......kYY...Y..',
    '........kYY.jY..',
    '.........kYiYYYj',
    '..........kYYYj.',
    '...........kYik.',
    '............kj..',
    '................',
  ],

  key_skeleton: [
    '................',
    '.1m11D..........',
    'D3111aD.........',
    'ahh3.11.........',
    'D13.XDD.........',
    'a13Xha1.........',
    'ma1D1hD.........',
    '.jmj1at1........',
    '......atD.......',
    '.......jtD...h..',
    '........jtD.mDa.',
    '.........aDtJjDD',
    '..........ktJta.',
    '............hh..',
    '.............j..',
    '................',
  ],
};

/**
 * Per-region overrides for the floor/wall chars ('F', 'f', 'W', 'w') so the
 * same sprite patterns render as 5 tilesets. Only the sewers region is used
 * in Milestone 1; the other four are placeholders for later regions.
 */
export const REGION_TINTS: Record<string, Record<string, string>> = {
  sewers: {
    F: '#5da02e', // reference grass base (ART-STYLE.md §5, v3)
    f: '#4b7e2a', // grass clump shade
    W: '#6e4c2c', // dirt-brown wall face, darker than floor so walls read
    w: '#74b53a', // sunlit grass cap, brightest terrain
  },
  prison: {
    F: '#6a7488', // cold blue-gray floor base
    f: '#565e72', // cold floor speckle
    W: '#424a5e', // blue-gray brick face
    w: '#5c6680', // brick highlight
  },
  caves: {
    F: '#6b5a48', // brown rough rock base
    f: '#57493a', // rock speckle
    W: '#453a2e', // dark rock face
    w: '#5f5142', // rock highlight
  },
  city: {
    F: '#9aa0ae', // pale marble base
    f: '#848a98', // marble speckle
    W: '#6e7488', // worked stone face
    w: '#8b91a3', // worked stone highlight
  },
  halls: {
    F: '#4a3f4a', // dark obsidian, faint red tint
    f: '#3a3138', // obsidian speckle
    W: '#2e2430', // dark obsidian face
    w: '#4a3a44', // faint red highlight
  },
};

/**
 * Validates the atlas: 16 rows x 16 cols, every char in the palette.
 * Returns a list of problems (empty = OK). Used by the smoke test.
 */
export function validateSprites(): string[] {
  const errors: string[] = [];
  for (const [name, rows] of Object.entries(SPRITES)) {
    if (rows.length !== ART_PX) errors.push(`${name}: ${rows.length} rows, expected ${ART_PX}`);
    rows.forEach((row, y) => {
      if (row.length !== ART_PX) {
        errors.push(`${name} row ${y}: ${row.length} chars, expected ${ART_PX}`);
      }
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (!(ch in PALETTE)) errors.push(`${name} (${x},${y}): unknown palette char '${ch}'`);
      }
    });
  }
  return errors;
}
