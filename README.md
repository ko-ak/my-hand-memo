# 手書きメモアプリ

PCとAndroidの両方で手書きメモを取れるPWAアプリ。

## 概要

- マルチデバイス対応（PC/Android）
- Firebaseによるクラウド保存
- オフライン時のローカル保存（IndexedDB）
- ペン・指・マウスの別操作認識
- レイヤー機能
- 選択範囲機能（投げ縄ツール）

## 技術スタック

- フレームワーク: PWA（Progressive Web App）
- 手書きエンジン: Konva.js
- ローカル保存: IndexedDB
- 認証: Firebase Authentication
- データベース: Firebase Firestore
- ストレージ: Firebase Storage

## 開発フェーズ

- フェーズ0: 技術スタック確定、環境構築
- フェーズ1: 基本手書き、Firebase保存、メモリスト
- フェーズ2: レイヤー機能
- フェーズ3: 選択範囲機能

## ドキュメント

詳細な要件定義は [docs/要件定義.md](docs/要件定義.md) を参照してください。

## ライセンス

MIT
