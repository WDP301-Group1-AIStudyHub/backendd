# Bao Cao Chi Tiet Ve Chunking Tai Lieu Va DR-RAG Trong Du An

Tai lieu nay mo ta cach AI Study Hub xu ly van ban tai lieu thanh chunks, gan metadata cho chunk, luu vao Pinecone, va sau do dung luong DR-RAG de tra loi cau hoi. Muc tieu cua bao cao la de co mot ban ghi chep day du, gan sat voi code hien tai, co the dung de debug, review kien truc, hoac giai thich he thong cho nguoi moi.

## 1. Tong Quan He Thong

Du an dung mot pipeline duy nhat cho chat RAG:

```text
Tai lieu upload
-> trich xuat text
-> tach chunks theo heading hoac fixed-size fallback
-> phan tich outline / cau truc
-> gan metadata vao moi chunk
-> embed bang Jina
-> upsert vao Pinecone
-> khi hoi AI: DR-RAG lay chunk, chon context, sinh cau tra loi, kiem tra grounding
```

Hai phan quan trong nhat la:

1. Chunking va indexing, quyen dinh chat co tim ra dung nghia hay khong.
2. DR-RAG, quyen dinh chat co nhin thay dung chunk va giu duoc context tot hay khong.

---

## Bang Tham So Va So Lieu Quan Trong

Tat ca so lieu duoi day la gia tri mac dinh trong source code hien tai. Mot so tham so co the duoc ghi de bang bien moi truong.

### Chunking

| Nhom | Tham so | Gia tri |
|---|---|---|
| Chunk size | `CHUNK_SIZE` | `1000` ky tu |
| Chunk overlap | `CHUNK_OVERLAP` | `200` ky tu |
| General section title | `GENERAL_SECTION_TITLE` | `General Content` |
| Heading body splitter min size | `Math.max(300, CHUNK_SIZE - headingLength - 1)` | toi thieu `300` ky tu |
| Fixed-size fallback chunk title | `sectionTitle` | `General Content` |

### Outline

| Nhom | Tham so | Gia tri |
|---|---|---|
| Outline types | `part`, `chapter`, `section`, `subsection`, `appendix`, `toc_entry`, `unknown` | `7` loai |
| Outline confidence threshold | `getOutlineNodesByType()` | `0.55` |
| Source preview length in sources | `contentPreview` | `220` ky tu |
| Expanded query content cap | `EXPANDED_QUERY_CONTENT_LIMIT` | `700` ky tu |

### DR-RAG Retrieval

| Nhom | Tham so | Gia tri |
|---|---|---|
| Default static topK | `DEFAULT_STATIC_CHUNK_LIMIT` | `4` chunk |
| Detailed static topK | `DETAILED_STATIC_CHUNK_LIMIT` | `6` chunk |
| Multi-document static topK | `MULTI_DOCUMENT_STATIC_CHUNK_LIMIT` | `6` chunk |
| Dynamic topK per static chunk | `DEFAULT_DYNAMIC_TOP_K_PER_STATIC_CHUNK` | `4` chunk |
| Max dynamic queries | `MAX_DYNAMIC_QUERIES` | `4` static seeds |
| Default final context limit | `DEFAULT_CONTEXT_CHUNK_LIMIT` | `8` chunk |
| Focused final context limit | `FOCUSED_CONTEXT_CHUNK_LIMIT` | `4` chunk |
| Detailed final context limit | `DETAILED_CONTEXT_CHUNK_LIMIT` | `16` chunk |
| Selection strategy | `selectionStrategy` | `cfs-heuristic` |

### Relevance And Fallback

| Nhom | Tham so | Mac dinh | Co the override |
|---|---|---:|---|
| Relevance threshold | `RELEVANCE_THRESHOLD` | `0.55` | yes |
| Pinecone relevance threshold | `PINECONE_RELEVANCE_THRESHOLD` | `0.3` | yes |
| Out-of-scope threshold | `PINECONE_OUT_OF_SCOPE_THRESHOLD` | `0.55` | yes |
| Minimum relevant chunks | `MIN_RELEVANT_CHUNKS` | `3` | yes |

### Multi-document Retrieval

| Nhom | Tham so | Gia tri |
|---|---|---|
| Per-document topK input | `perDocumentTopK` | `2` hoac `3` |
| Actual per-document Pinecone topK | `Math.max(perDocumentTopK, 4)` | `4` chunk moi document |
| Broad query fallback topK | `topKPerDocument * 3` | `6` hoac `9` chunk |

### Validation

| Nhom | Tham so | Gia tri |
|---|---|---|
| Question max length | `question` | `2000` ky tu |
| `documentIds` max length | `documentIds` | `20` ids |
| Subject max length | `subject` | `80` ky tu |
| Allowed scope values | `scope` | `single_document`, `subject_all`, `document_set`, `library_all` |

### Grounding

| Nhom | Tham so | Gia tri |
|---|---|---|
| Grounding temperature | `temperature` | `0` |
| Grounding max tokens | `maxTokens` | `250` |
| Grounding threshold normal answers | `checkAnswerGrounding()` | `0.4` |
| Grounding threshold summary / multi-doc / illustrative | `checkAnswerGrounding()` | `0.25` |

### Quick Recall

- Chunking mac dinh: `1000` ky tu, overlap `200`.
- Static topK: `4` hoac `6`.
- Dynamic topK moi static seed: `4`.
- So static seed toi da de tao query dong: `4`.
- Final context: `4`, `8`, hoac `16` chunk tuy truong hop.
- Relevance threshold: `0.55`.
- Pinecone threshold: `0.3`.
- Grounding threshold: `0.4` binh thuong, `0.25` voi summary/multi-doc.

## 2. Chunk La Gi Trong Du An Nay

Mot chunk khong chi la mot doan van ban bi cat ra. Trong du an nay, chunk la don vi nghia co:

- Noi dung text.
- So thu tu chunk.
- Ten heading / section.
- Chi so section trong tai lieu.
- Thong tin outline.
- Nhan chuong / phan / muc neu doc duoc cau truc.
- Metadata ve document, subject, version, user.

Chunk duoc tao de phuc vu cho retrieval semantic, nhung van giu duoc ngu canh co cau truc. Do do chunk trong du an khong chi co `content`; no con mang theo ca `outlinePath`, `sectionTitle`, `semanticSectionLabel`, `chapterOrdinal`, `outlineNodeId`.

### Chunk object o cap text splitter

`splitTextForRag()` trong [textSplitter.ts](../src/utils/textSplitter.ts) tao ra `DocumentChunk` voi metadata:

- `heading`
- `sectionTitle`
- `sectionIndex`
- `contentLength`
- `textLength`
- `chunkingStrategy`
- `section`
- `inferredSection`
- `semanticSectionLabel`
- `outlineNodeId`
- `outlinePath`
- `outlineLevel`
- `outlineType`
- `chapterOrdinal`

Day la lop metadata quan trong nhat de DR-RAG co the hieu chunk thuoc phan nao cua tai lieu.

---

## 3. Cach Tai Lieu Duoc Tach Thanh Chunk

### 3.1 Lam sach text truoc khi chunk

Trong `splitTextForRag()`:

1. Repair loi encoding.
2. Loai cac dong noise cua tai lieu.
3. Tim cac heading / section.
4. Neu co heading hop le, chunk theo heading.
5. Neu khong co heading, dung fixed-size fallback.

### 3.2 Logic heading-based chunking

File [textSplitter.ts](../src/utils/textSplitter.ts) co logic:

- Quet tung dong cua tai lieu.
- Dung `detectSectionFromHeading()` de xac dinh dong nao la heading.
- Neu gap heading moi, flush phan body hien tai thanh mot section.
- Moi section co:
  - `heading`: tieu de tim thay.
  - `sectionTitle`: heading hoac `General Content`.
  - `sectionIndex`: vi tri section trong tai lieu.
  - `body`: noi dung ben duoi heading.

Neu section qua dai so voi `CHUNK_SIZE = 1000`, body se duoc cat tiep bang `RecursiveCharacterTextSplitter` voi:

- `chunkSize = 1000 - headingLength - 1`
- `chunkOverlap = 200`

Nghia la:

- Chunk co dung ngu canh heading se duoc uu tien giu tron.
- Khi doan noi dung qua dai, splitter cat van giu overlap 200 ky tu de tranh mat cau, mat y.

### 3.3 Fixed-size fallback

Neu khong tim thay heading hop le, he thong chuyen sang fallback:

- Dung text splitter binh thuong.
- Moi chunk co `heading = null`.
- `sectionTitle = "General Content"`.
- `chunkingStrategy = "fixed-size-fallback"`.

Day la phuong an an toan cho tai lieu nghieng ve van ban lien tuc, khong co cau truc ro rang.

### 3.4 Vi sao overlap 200 la quan trong

Overlap giup:

- Cau o cuoi chunk truoc khong bi mat ngu canh.
- Tu khoa nam giua hai doan van co co hoi xuat hien o ca hai chunk.
- Cac cau hoi dua vao mot y nho co the lay lai dung chunk hon.

Nhung overlap cung lam tang so chunk va so vector, nen co can bang giua:

- Do bao phu.
- Chi phi embedding.
- Toc do retrieval.

---

## 4. Outline Va Cau Truc Tai Lieu

Sau khi chunk xong, du an tiep tuc phan tich outline trong [documentOutline.ts](../src/utils/documentOutline.ts).

### 4.1 Outline la gi

Outline la mot cay cau truc:

- `part`
- `chapter`
- `section`
- `subsection`
- `appendix`
- `toc_entry`
- `unknown`

Moi node co:

- `id`
- `parentId`
- `level`
- `type`
- `title`
- `ordinal`
- `source`
- `confidence`

### 4.2 Outline duoc tao tu dau

He thong trich outline tu:

1. Semantic outline neu extractor cua tai lieu co tra ve.
2. Chunk headings neu document co heading-based chunking.

Sau do:

- Dedupe node trung nhau.
- Gan parent theo level.
- Tinh `outlinePath`.

### 4.3 Li do outline quan trong

Outline giup chunk co them “dia chi nghia”:

- Chunk thuoc chuong nao.
- Chunk thuoc muc nao.
- Chunk co dang nam trong cung section voi chunk nao.

Khi DR-RAG can tim chunk dinh huong, outline metadata giup:

- Group chunk theo section.
- Build expanded query co them section/title.
- Chon dynamic chunk gan dung chuong / muc hon.

---

## 5. Indexing: Tu Chunk Sang Pinecone

File [rag.service.ts](../src/services/rag.service.ts) la cau noi giua chunking va vector store.

### 5.1 Indexing flow

```text
Text da trich xuat
-> splitTextForRag()
-> extractDocumentOutline()
-> summarizeDocumentOutline()
-> analyzeDocumentStructure()
-> applyOutlineToChunks()
-> upsertDocumentChunks()
```

### 5.2 applyOutlineToChunks

Ham nay gan them metadata outline vao tung chunk:

- `outlineNodeId`
- `outlinePath`
- `outlineLevel`
- `outlineType`
- `chapterOrdinal`

Day la buoc rat quan trong, vi Pinecone khong chi luu content ma con luu meta de retrieval va selection sau nay.

### 5.3 upsertDocumentChunks

`upsertDocumentChunks()` trong [vector.service.ts](../src/services/vector.service.ts) se:

- Tao embedding bang Jina.
- Upsert tung record vao Pinecone.
- Dat id vector theo:
  - `documentId:versionId:chunkIndex` neu co version.
  - `documentId:chunkIndex` neu khong co version.

### 5.4 Metadata luu trong Pinecone

Moi vector chunk duoc luu voi metadata:

- `documentId`
- `versionId`
- `versionNumber`
- `ownerId`
- `userId`
- `subject`
- `subjectId`
- `title`
- `chunkIndex`
- `heading`
- `sectionTitle`
- `sectionIndex`
- `contentLength`
- `section`
- `inferredSection`
- `semanticSectionLabel`
- `outlineNodeId`
- `outlinePath`
- `outlineLevel`
- `outlineType`
- `chapterOrdinal`
- `content`

Day la ly do DR-RAG co the truy cap den chunk theo khong chi noi dung, ma con theo document/subject/section.

---

## 6. Tai Sao Chunking Nay Hieu Qua

### 6.1 Heading-based chunking giup giu nghia

Neu chunk cat theo heading:

- Chunk co tien de noi dung.
- Chunk de doc.
- Chunk co the map voi cau hoi ve chuong / muc.

Vi du:

- Cau hoi `chuong 2 noi ve gi?`
- Chunk co `sectionTitle = Chuong 2`
- DR-RAG co the lay dung khu vuc nhanh hon.

### 6.2 Fixed-size fallback bao ve tai lieu khong co cau truc

Khong phai tai lieu nao cung co heading ro rang. Khi do fallback giu cho indexing khong bi that bai.

### 6.3 Outline metadata giup chon chunk co ngu canh

DR-RAG can chunk khong chi “gan tu khoa”, ma con:

- Co cung section voi chunk da chon.
- Co them y moi.
- Khong lap lai dung noi dung da co.

### 6.4 Overlap lam giam mat ngu canh

Chunk overlap 200 ky tu giup:

- Cau cuoi doan khong bi cat dut.
- Cac dap an multi-hop co co hoi lay lai y sau.

---

## 7. DR-RAG Trong Du An

File [drRag.service.ts](../src/services/drRag.service.ts) la trung tam tra loi cau hoi.

### 7.1 Tong quat

```text
User question
-> resolve chat scope
-> classify intent
-> rewrite query neu can
-> stage 1 retrieve static chunks
-> select static chunks
-> build expanded queries
-> stage 2 retrieve dynamic chunks
-> CFS heuristic selection
-> build final context
-> generate answer with Groq
-> grounding check
-> fallback neu can
```

### 7.2 Stage 1: static retrieval

Muc tieu cua stage 1 la lay ra chunk “co ve lien quan truc tiep” voi cau hoi.

Dau vao:

- Cau hoi goc hoac query rewrite.
- Filter theo user.
- Filter theo document / subject / scope.

Ket qua:

- Danh sach chunk da duoc evaluate.
- Chunk co `relevanceScore`, `pineconeScore`, `isRelevant`.

He thong co the:

- Uu tien chunk co score cao.
- Lay chunk theo document-set neu user hoi trong nhieu tai lieu.

### 7.3 Static selection

Tu stage 1, DR-RAG chon `staticChunks` theo:

- `relevanceThreshold`
- `pineconeRelevanceThreshold`
- so chunk toi da phu thuoc loai cau tra loi:
  - focused
  - detailed
  - multi-document

Static chunk la “xuong song” cua context final.

### 7.4 Stage 2: dynamic retrieval

Sau khi co static chunk, he thong build expanded query:

```text
question
Document: <title>
Section: <outline/heading/sectionTitle>
Known context: <content cat gon cua static chunk>
```

Muc tieu:

- Kich ra chunk ma mot query don le khong thay.
- Tim y lien quan trong cung section, hoac chunk tiep theo cua cung mach noi dung.

Moi static chunk co the sinh mot expanded query.
Sau do Pinecone se tra ve dynamic candidates.

### 7.5 CFS-style selection

Trong paper, CFS la classifier chon chunk bo sung. Trong repo nay, v1 dung heuristic:

- Lay static chunk truoc.
- Duyet dynamic candidates theo thu tu score.
- Chon chunk dau tien:
  - vuot nguong relevance,
  - va co noi dung moi so voi context hien tai.

`hasNovelInformation()` kiem tra:

- Chunk khong trung id.
- Chunk khong trung section qua nhieu.
- Chunk co ty le tu moi du lon.

Neu khong co dynamic chunk tot:

- Giua static context.
- Khong ep them rui ro.

### 7.6 Context final

Final context `Cnt` duoc build tu:

- static chunks
- selected dynamic chunks

Sau do context duoc gui mot lan toi Groq de sinh tra loi.

### 7.7 Grounding check

Sau khi Groq tra loi:

- He thong chay `checkAnswerGrounding()`.
- Neu response khong grounded:
  - Tra ve fallback an toan.
  - Khong quay ve basic/corrective mode vi mode do da bi loai bo.

---

## 8. DR-RAG Hoat Dong Nhu The Nao Tren Du An Nay

### 8.1 Dau vao cau hoi

Nguoi dung gui:

- `question`
- `scope`
- `documentId` hoac `documentIds`
- `subjectId`
- `subject`

### 8.2 Scope

`resolveChatScope()` quyet dinh:

- Tra loi trong toan library.
- Tra loi trong mot document.
- Tra loi trong mot subject.
- Tra loi trong mot bo document cua cung subject.

### 8.3 Intent va answer profile

He thong co them tang:

- classify intent
- detect answer profile
- rewrite academic query neu phu hop

Vi vay DR-RAG khong chi retrieval ma con biet:

- Cau hoi nay la summary hay QA.
- Cau tra loi can ngan hay chi tiet.

### 8.4 Chon chunk co ngu canh

Chunk khong duoc chon chi vi co tu khoa. No con can:

- gan section hop ly,
- co novelty,
- khong lap context.

### 8.5 Sinh cau tra loi

Groq nhan:

- question
- context final
- intent
- answer profile
- subject / document title neu co

Ket qua la mot lan generate duy nhat.

### 8.6 Fallback

Fallback xay ra khi:

- Khong co chunk phu hop.
- Cau hoi qua out-of-scope.
- Answer khong grounded.
- Tai lieu dang processing.

Fallback giup he thong khong tra loi bua.

---

## 9. Vi Sao Tai Lieu Nay Co The Co Nguon Dung Hoac Sai

Chat RAG phu thuoc rat nhieu vao chunking. Neu chunking sai, DR-RAG se sai theo.

### Tranh hop chunking qua to

Neu chunk qua dai:

- Retrieval kem chinh xac.
- Groq nhan qua nhieu van ban.
- Mat chi tiet cap section.

### Tranh hop chunking qua nho

Neu chunk qua nho:

- Mat context.
- Dynamic retrieval co the lay chunk khong du y.
- Answer de bi doan, lap, hoac sai ngu canh.

### Tranh hop chunk khong co outline

Neu khong co outline:

- Stage 2 khong co “cau neo” de mo rong query.
- CFS heuristic kem hieu qua hon.

---

## 10. Cac Truong Metadata Quan Trong Nhat

### 10.1 Metadata o cap chunk

Nhung truong tac dong manh nhat:

- `sectionTitle`
- `outlinePath`
- `outlineNodeId`
- `outlineLevel`
- `chapterOrdinal`
- `semanticSectionLabel`
- `chunkIndex`

### 10.2 Metadata o cap vector

Nhung truong tac dong den retrieval:

- `documentId`
- `userId`
- `subjectId`
- `subject`
- `title`
- `chunkIndex`
- `sectionTitle`
- `outlinePath`

### 10.3 Metadata o cap answer evaluation

Nhung truong tac dong den debug:

- `retrievedChunksCount`
- `stageOneChunksCount`
- `stageTwoChunksCount`
- `selectedStaticChunksCount`
- `selectedDynamicChunksCount`
- `retrievalQueries`
- `selectionStrategy`
- `contextChunksUsed`
- `retrievedSections`

---

## 11. Vi Du Hinh Dung

Gia su tai lieu co 3 chuong:

- Chuong 1: Can ban.
- Chuong 2: Vat chat va y thuc.
- Chuong 3: Nhan thuc va thuc tien.

### Neu hoi

`Vì sao vật chất quyết định ý thức?`

He thong se:

1. Retrieve static chunk co lien quan truc tiep toi `vat chat`, `y thuc`.
2. Build query mo rong voi `Chuong 2`.
3. Tim dynamic chunk trong cung chuong co giai thich ve tac dong, vi du, hoac dinh nghia bo sung.
4. Chon chunk co them y moi, khong lap lai.
5. Gui context hop nhat cho Groq.

### Neu hoi

`Tài liệu có mấy chương?`

He thong se:

1. Nhin vào outline/section metadata.
2. Dem chuong da duoc dedupe.
3. Tra ve so luong chuong neu tai lieu co cau truc ro.

Neu tai lieu khong co chuong ro rang, hoac chunking fallback, ket qua co the khong chinh xac hoan toan.

---

## 12. Dieu Khien Hanh Vi Retrieval

DR-RAG trong du an co cac nguong va gioi han can bang:

- `RELEVANCE_THRESHOLD`
- `PINECONE_RELEVANCE_THRESHOLD`
- `MIN_RELEVANT_CHUNKS`
- `DEFAULT_STATIC_CHUNK_LIMIT`
- `MAX_DYNAMIC_QUERIES`
- `DEFAULT_DYNAMIC_TOP_K_PER_STATIC_CHUNK`
- `DEFAULT_CONTEXT_CHUNK_LIMIT`

Nhung gia tri nay quyet dinh:

- lay bao nhieu chunk ban dau,
- lay them bao nhieu chunk dong,
- context co qua dai hay khong,
- co de fallback qua som hay khong.

---

## 13. Lua Chon Thiet Ke Quan Trong

### 13.1 Khong con basic/corrective mode

Du an da chuyen sang mot pipeline duy nhat:

- DR-RAG

Dieu nay lam:

- API don gian hon.
- Tracking don gian hon.
- Khong con dich chuyen qua lai giua nhieu mode.

### 13.2 Khong dung Groq lam classifier nhieu lan

V1 khong goi Groq lap di lap lai de quyet dinh chunk nao duoc chon. Thay vao do:

- Dung Pinecone score.
- Dung lexical overlap.
- Dung metadata section/outline.
- Dung novelty heuristic.

Loi ich:

- Latency tot hon.
- Chi phi thap hon.
- Behavior on dinh hon.

---

## 14. Cach Doc Log Khi Debug

Khi debug, hay nhin:

1. `chunkingStrategy`
2. `detectedSections`
3. `retrievalQueries`
4. `stageOneChunksCount`
5. `stageTwoChunksCount`
6. `selectedStaticChunksCount`
7. `selectedDynamicChunksCount`
8. `contextChunksUsed`
9. `retrievedSections`
10. `fallbackReason`

Neu chunkingStrategy la `fixed-size-fallback`, ban nen nghi ngay den:

- Tai lieu khong co heading ro rang.
- Document outline khong tu hop le.
- chunk metadata sectionTitle co the chi la `General Content`.

Neu `stageOneChunksCount` cao nhung `selectedStaticChunksCount` thap, co the:

- score threshold qua cao,
- query rewrite khong tot,
- subject/document scope qua hep.

Neu `stageTwoChunksCount` co ma `selectedDynamicChunksCount = 0`, co the:

- candidate khong co novelty,
- candidate bi lap section,
- Pinecone score khong qua threshold.

---

## 15. Ket Luan

Chunking trong du an nay khong chi la tach text thanh cac doan nho. No la lop co cau truc, co y nghia, co outline, va co metadata day du de DR-RAG co the:

- Tim dung chunk.
- Mo rong dung ngu canh.
- Loai bo lap lai.
- Sinh cau tra loi grounded hon.

DR-RAG cua du an dang chay theo mot pipeline don, ro, va co the debug duoc:

```text
chunking -> outline -> embedding -> Pinecone -> stage 1 -> stage 2 -> selection -> Groq -> grounding -> fallback
```

Neu can hieu toan bo he thong, hay bat dau tu chunking. Neu chunking dung, DR-RAG co nen tang tot. Neu chunking sai, retrieval va answer se sai theo.
