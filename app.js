const express = require('express')
const expressWs = require('express-ws')
const Majiang = require('@kobalab/majiang-core')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001

app.use('/dist', express.static('dist'))
app.use(express.static('public'))

let waitingPlayers = []
let roomCounter = 1
let waitingCount = 0
const rooms = {}

app.ws('/ws', (ws, req) => {
  console.log('🔌 新しいクライアントが接続しました')

  waitingPlayers.push(ws)
  waitingCount++
  console.log(`🧍 現在の待機人数: ${waitingCount}`)

  waitingPlayers.forEach((player) => {
    if (player.readyState === 1) {
      player.send(JSON.stringify({ type: 'waiting', count: waitingPlayers.length }))
    }
  })

  if (waitingPlayers.length >= 2) {
    const roomId = `room-${roomCounter++}`
    const players = waitingPlayers.splice(0, 2)
    waitingCount -= 2

    console.log(`🎮 ルーム作成: ${roomId} で 2人の対戦を開始します`)

    rooms[roomId] = {
      players,
      hands: [],
      shoupais: [],
      mountain: [],
      currentTurn: 0
    }

    startGame(roomId)
  }

  ws.on('message', (msg) => {
    const data = JSON.parse(msg)
    const room = rooms[data.roomId]
    if (!room) return

    const playerIndex = data.playerIndex

    if (data.type === 'dahai') {
      const shoupai = room.shoupais[playerIndex]
      const paiStr = convertPaiIndexToMPSZ(data.pai)
      shoupai.dapai(paiStr)

      const opponentIndex = (playerIndex + 1) % 2
      const oppShoupai = room.shoupais[opponentIndex]

      const ronResult = Majiang.Util.hule(
        oppShoupai,
        paiStr + '-',
        Majiang.Util.hule_param({
          zhuangfeng: 0,
          menfeng: opponentIndex,
          baopai: null,
          changbang: 0,
          lizhibang: 0,
        })
      )

      room.isRiichiFlags[playerIndex] = data.isRiichi;

      room.players.forEach((player) => {
        if (player.readyState === 1) {
          player.send(JSON.stringify({
            type: 'dahai',
            playerIndex,
            pai: data.pai,
            isRiichi: data.isRiichi
          }))
        }
      })

      if (ronResult) {
        room.players[opponentIndex].send(JSON.stringify({
          type: 'ronCheck',
          pai: data.pai,
          fromPlayer: playerIndex,
          roomId: data.roomId
        }))
        return;
      }

      room.currentTurn = (room.currentTurn + 1) % 2
      const nextPlayer = room.players[room.currentTurn]

      room.currentTurn = (playerIndex + 1) % 2;
      if (room.mountain.length > 0) {
        const nextPai = room.mountain.shift();
        const nextPaiStr = convertPaiIndexToMPSZ(nextPai);
        room.shoupais[room.currentTurn].zimo(nextPaiStr);
        handleTsumoPhase(room, room.currentTurn, data);
      } else {
        console.log('🈳 山が尽きました（流局）');
      }
    }

    if (data.type === 'ron') {
      const winnerIndex = data.playerIndex;
      const loserIndex = (winnerIndex + 1) % 2;
      console.log('ron'+1);
      const winnerShoupai = room.shoupais[winnerIndex];
      const paiStr = convertPaiIndexToMPSZ(data.pai); // 例: "m1"
      console.log('ron'+2);

      // 手牌にロン牌を加える（シミュレーション用）
      const tempShoupai = Majiang.Shoupai.fromString(winnerShoupai.toString());
      tempShoupai.zimo(paiStr); // 通常はツモでしか使わないが、hule() は null でロン判定できる
      console.log('ron'+3);

      // 和了判定＆詳細
      const huleData = Majiang.Util.hule(
        tempShoupai,
        paiStr + '-',  // ロンの形式
        Majiang.Util.hule_param({
          zhuangfeng: 0,
          menfeng: winnerIndex,
          baopai: room.baopai || [],       // ドラ（未設定なら空配列）
          fubaopai: room.fubaopai || [],   // 裏ドラ（リーチ時に考慮）
          changbang: room.changbang || 0, // 連荘
          lizhibang: room.lizhibang || 0  // リーチ棒
        })
      );

      console.log('あがり（ユーザー操作によるロン）');

      if (!huleData) {
        console.log('※和了条件を満たしていないため点数計算なし');
        return;
      }
      console.log('ron'+4);

      // 得点情報を取得
      const defen = huleData.defen; // { fu: 30, fan: 3, point: 3900 } など
      const scoreDelta = defen.point;
      console.log('ron'+5);

      // 点数を加減（room.scores[] に得点保持していると仮定）
      room.scores[winnerIndex] += scoreDelta;
      room.scores[loserIndex] -= scoreDelta;
      console.log('ron'+6);

      // 両者に通知
      room.players.forEach((player, index) => {
        if (player.readyState === 1) {
          player.send(JSON.stringify({
            type: 'ron',
            winner: winnerIndex,
            loser: loserIndex,
            pai: data.pai,
            scoreDelta,
            newScores: room.scores,
            huleDetail: {
              fu: defen.fu,
              fan: defen.fan,
              point: defen.point,
              han: huleData.han,
              yaku: huleData.yaku.map(y => `${y.name}(${y.fu || y.fan})`)  // 役一覧
            }
          }));
        }
      });
    }


    if (data.type === 'skip') {
      room.currentTurn = (room.currentTurn + 1) % 2
      const nextPlayer = room.players[room.currentTurn]

      if (room.mountain.length > 0) {
        const nextPai = room.mountain.shift();
        const nextPaiStr = convertPaiIndexToMPSZ(nextPai);
        room.shoupais[room.currentTurn].zimo(nextPaiStr);

        handleTsumoPhase(room, room.currentTurn, data);
      } else {
        console.log('🈳 山が尽きました（流局）');
      }
    }

    if (data.type === 'tsumo') {
      const winner = data.playerIndex
      room.players.forEach((player) => {
        if (player.readyState === 1) {
          player.send(JSON.stringify({
            type: 'tsumo',
            winner,
            pai: null
          }))
        }
      })
      console.log('あがり（ツモ）')
    }

    if (data.type === 'log') {
      console.log(`🪵 クライアントログ: ${data.message}`)
      return
    }
  })

  ws.on('close', () => {
    console.log('❌ クライアントが切断されました')
    waitingPlayers = waitingPlayers.filter((p) => p !== ws)
    waitingCount--
    console.log(`🧍 現在の待機人数: ${waitingCount}`)
  })
})

app.listen(port, () => {
  console.log(`🚀 サーバー起動中: http://localhost:${port}`)
})

function startGame(roomId) {
  const room = rooms[roomId];
  room.isRiichiFlags = [false, false];
  const tiles = Array.from({ length: 136 }, (_, i) => i);
  shuffle(tiles);
  console.log(4)


  // 🔧 テスト用固定牌構成
  const fixedHand0 = [0, 1, 2, 4, 8, 12, 36, 40, 44, 108, 109, /*予備:*/ 5, 6]; // プレイヤー0
  const fixedHand1 = [96, 100, 104, 32, 36, 40, 4, 8, 12, 110, 111, /*補完:*/ 33, 34]; // プレイヤー1 (即ロン用)
  const hands = [fixedHand0, fixedHand1]


  //const hands = [tiles.slice(0, 13), tiles.slice(13, 26)];
  const mountain = [108, ...tiles.slice(27)];
  const shoupais = [];

  for (let i = 0; i < 2; i++) {
    const handString = convertPaiArrayToStringSorted(hands[i]); // → m123p456z77 形式
    console.log(handString);
    const sp = Majiang.Shoupai.fromString(handString);
    shoupais.push(sp);
    console.log('配牌 ${i}:, sp.toString()');
  }
  console.log(5)
  // 先手（player 0）にもう1枚ツモ
  const firstDraw = mountain.shift();
  shoupais[0].zimo(convertPaiIndexToMPSZ(firstDraw));

  console.log(6)
  // 状態をルームに保存
  room.shoupais = shoupais;
  room.mountain = mountain;
  room.currentTurn = 0;
  console.log(7)
  // クライアントに初期手牌を送信
  room.players.forEach((player, i) => {
    const shoupai = shoupais[i];

    // 🀄 初期手牌送信
    player.send(JSON.stringify({
      type: 'start',
      playerIndex: i,
      roomId,
      handString: shoupai.toString()
    }));

    // ✅ ツモ和了チェックは先手だけ
    if (i === 0) {
      const tsumoResult = Majiang.Util.hule(
        shoupai,
        null,
        Majiang.Util.hule_param({
          zhuangfeng: 0,
          menfeng: i,
          baopai: null,
          changbang: 0,
          lizhibang: 0
        })
      );

      if (tsumoResult) {
        player.send(JSON.stringify({
          type: 'tsumoCheck',
          roomId,
          playerIndex: i
        }));
      }
      console.log('10');
      // ✅ リーチチェックも先手のみに行う
      if (shoupai._zimo) {
        console.log('11');
        const shanten = Majiang.Util.xiangting(shoupai);
        if (shanten <= 0) {
          console.log('12');
          const tingpaiList = getReachableTiles(shoupai); // ← ここは関数を定義しておく必要あり
          if (tingpaiList.length > 0) {
            console.log('tingpaiList:' + tingpaiList);
            player.send(JSON.stringify({
              type: 'riichiCheck',
              roomId,
              playerIndex: i,
              tingpaiList
            }));
          }
        }
      }
    }
  });
}

function handleTsumoPhase(room, playerIndex, data) {
  const player = room.players[playerIndex];
  const shoupai = room.shoupais[playerIndex];

  const tsumoResult = Majiang.Util.hule(
    shoupai,
    null,
    Majiang.Util.hule_param({
      zhuangfeng: 0,
      menfeng: playerIndex,
      baopai: null,
      changbang: 0,
      lizhibang: 0,
    })
  );

  if (player.readyState === 1) {
    player.send(JSON.stringify({
      type: 'tsumo',
      playerIndex,
      roomId: data.roomId,
      handString: shoupai.toString(),
      aitenoRiichi: room.isRiichiFlags[(playerIndex + 1) % 2]
    }));

    const shanten = Majiang.Util.xiangting(shoupai);
    console.log(`シャンテン: ${shanten}`);

    if (shanten <= 0) {
      const tingpaiList = getReachableTiles(shoupai);
      console.log('リーチ可能牌:', tingpaiList);

      player.send(JSON.stringify({
        type: 'riichiCheck',
        roomId: data.roomId,
        playerIndex,
        tingpaiList
      }));
    }

    if (tsumoResult) {
      player.send(JSON.stringify({
        type: 'tsumoCheck',
        roomId: data.roomId,
        playerIndex
      }));
    }
  }
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[array[i], array[j]] = [array[j], array[i]]
  }
}

function convertPaiIndexToMPSZ(pai) {
  const typeIndex = Math.floor(pai / 4);
  if (typeIndex < 9) return 'm' + (typeIndex + 1);
  if (typeIndex < 18) return 'p' + (typeIndex - 9 + 1);
  if (typeIndex < 27) return 's' + (typeIndex - 18 + 1);
  return 'z' + (typeIndex - 27 + 1);
}

// サーバー側に置いておくユーティリティ関数
function getReachableTiles(shoupai) {
  const reachable = new Set();

  // ① 手牌文字列を取得
  const handStr = shoupai.toString();
  let suit = '';
  const tiles = [];

  // ② suit+ch で一旦 ["m1","m1",...,"p9",...] の形に格納
  for (const ch of handStr) {
    if ('mpsz'.includes(ch)) {
      suit = ch;
    }
    else {
      tiles.push(suit + ch);
    }
  }

  // ③ 1 枚ずつ試し打ち
  for (const tile of tiles) {
    const clone = Majiang.Shoupai.fromString(handStr);
    // check=false で例外を抑制
    if (!clone.dapai(tile, false)) continue;
    if (Majiang.Util.xiangting(clone) === 0) {
      reachable.add(tile);
    }
  }

  // ④ suit+digit → digit+suit に入れ替え、インデックス化
  return Array.from(reachable).map(ts => {
    // ts は "p9" など
    const swapped = ts.charAt(1) + ts.charAt(0);  // "9p"
    console.log('swapped' + swapped);
    return convertMPSZToPaiIndex(swapped);
  });
}


function convertShoupaiToArray(shoupai) {
  const result = []
  const allPai = shoupai._bingpai
  for (const suit of ['m', 'p', 's', 'z']) {
    const tiles = allPai[suit]
    for (let i = 0; i < tiles.length; i++) {
      const count = tiles[i]
      for (let j = 0; j < count; j++) {
        result.push(convertMPSZToPaiIndex((i + 1) + suit))
      }
    }
  }
  return result.sort((a, b) => a - b)
}

function convertMPSZToPaiIndex(paiStr) {
  const num = parseInt(paiStr[0])
  const suit = paiStr[1]
  let base = 0
  if (suit === 'p') base = 9
  else if (suit === 's') base = 18
  else if (suit === 'z') base = 27
  const tileIndex = base + num - 1
  return tileIndex * 4 // 常に0番目のインスタンス
}

function convertPaiArrayToStringSorted(paiArray) {
  const paiCounts = {
    m: Array(9).fill(0),
    p: Array(9).fill(0),
    s: Array(9).fill(0),
    z: Array(7).fill(0)
  };

  for (const pai of paiArray) {
    const typeIndex = Math.floor(pai / 4);
    if (typeIndex < 9) paiCounts.m[typeIndex]++;
    else if (typeIndex < 18) paiCounts.p[typeIndex - 9]++;
    else if (typeIndex < 27) paiCounts.s[typeIndex - 18]++;
    else paiCounts.z[typeIndex - 27]++;
  }

  let result = '';

  for (const suit of ['m', 'p', 's']) {
    const tiles = paiCounts[suit];
    let suitStr = '';
    for (let i = 0; i < tiles.length; i++) {
      suitStr += String(i + 1).repeat(tiles[i]);
    }
    if (suitStr !== '') result += suit + suitStr;
  }

  const honors = paiCounts.z;
  let honorStr = '';
  for (let i = 0; i < honors.length; i++) {
    honorStr += String(i + 1).repeat(honors[i]);
  }
  if (honorStr !== '') result += 'z' + honorStr;

  return result;
}