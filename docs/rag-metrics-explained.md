# Giải thích RAG Metrics trong AI Study Hub

Tài liệu này giải thích cách backend hiện tại tính các metric trong response `evaluation` và trong từng `chunk/source`. Nội dung dựa trên implementation hiện tại trong các file:

- `src/services/rag.service.ts`
- `src/services/correctiveRag.service.ts`
- `src/services/relevance.service.ts`
- `src/services/vector.service.ts`
- `src/services/answerCheck.service.ts`
- `src/services/intentClassifier.service.ts`
- `src/utils/textSplitter.ts`
- `src/utils/documentSection.ts`

## 1. Tổng quan đơn giản

Khi user hỏi chatbot, backend chạy RAG theo 2 chế độ:

- `basic`: lấy chunks từ Pinecone rồi đưa vào Groq để trả lời.
- `corrective`: rewrite query, retrieve chunks, chấm relevance từng chunk, có thể retrieve lần hai, fallback nếu evaluator reject hết, rồi mới sinh answer.

Flow chính:

```text
User question
↓
Intent classification bằng Groq
↓
Jina embedding cho query
↓
Pinecone semantic search
↓
Retrieved chunks
↓
Relevance evaluation trong backend
↓
Chọn chunks làm context
↓
Groq answer generation
↓
Groq grounding/self-check
↓
Evaluation metrics
```

## 2. Code flow tổng thể

### Basic RAG

Function chính: `askQuestionWithRag` trong `src/services/rag.service.ts`.

```text
askQuestionWithRag
 → searchRelevantChunks(question)
 → classifyQuestionIntent(question)
 → select top chunks
 → generateAnswerFromContext / generateEntityExtractionAnswer
 → checkAnswerGrounding
 → return evaluation
```

Basic RAG không gọi `evaluateRetrievedChunks`, nên các metric relevance ở basic đơn giản hơn:

- `retrievedChunksCount = chunks.length`
- `relevantChunksCount = chunks.length`
- `averageRelevanceScore = 1` nếu có chunks, ngược lại `0`

### Corrective RAG

Function chính: `askQuestionWithCorrectiveRag` trong `src/services/correctiveRag.service.ts`.

```text
askQuestionWithCorrectiveRag
 → classifyQuestionIntent(question)
 → rewriteAcademicQuery(question)
 → searchRelevantChunks(rewrittenQuery, topK = 8)
 → evaluateRetrievedChunks(question + rewrittenQuery)
 → nếu relevantChunks < 3 và intent không phải extraction:
      rewrite lần 2
      searchRelevantChunks(stricterQuery, topK = 8)
      evaluateRetrievedChunks(...)
      dedupe chunks
 → nếu retrieved có chunks nhưng relevant = 0:
      fallback top Pinecone chunks
 → selectAnswerChunks by relevanceThreshold
 → generate answer bằng Groq
 → checkAnswerGrounding bằng Groq
 → return evaluation
```

## 3. `evaluation.retrievedChunksCount`

### Ý nghĩa

Số chunk đã được hệ thống retrieve và đưa vào bước đánh giá RAG.

### Sinh ở đâu?

- Basic: `src/services/rag.service.ts`, function `askQuestionWithRag`.
- Corrective: `src/services/correctiveRag.service.ts`, function `askQuestionWithCorrectiveRag`.

### Cách tính

Basic:

```ts
retrievedChunksCount: chunks.length
```

Corrective:

```ts
retrievedChunksCount: evaluatedChunks.length
```

Trong corrective, `evaluatedChunks` là chunks đã được Pinecone retrieve và backend đã tính relevance. Nếu có second-pass retrieval, danh sách này là kết quả đã dedupe từ cả 2 lần retrieval.

### Phụ thuộc vào dữ liệu nào?

- Pinecone semantic search result.
- Filter theo `userId`, optional `documentId`, optional `subject`.
- `topK`: basic mặc định `5`, corrective dùng `8` mỗi pass.

### Nguồn metric

Pinecone retrieval + backend counting.

## 4. `evaluation.relevantChunksCount`

### Ý nghĩa

Số chunk được backend xem là liên quan sau bước relevance evaluation.

### Sinh ở đâu?

- Basic: `src/services/rag.service.ts`.
- Corrective: `src/services/correctiveRag.service.ts`.

### Cách tính

Basic:

```ts
relevantChunksCount: chunks.length
```

Với basic, hệ thống chưa chấm relevance riêng, nên chunk retrieve được coi là relevant.

Corrective:

```ts
relevantChunks = evaluatedChunks.filter((chunk) => chunk.isRelevant)
relevantChunksCount: relevantChunks.length
```

`isRelevant` được tính trong `evaluateChunkRelevance` ở `src/services/relevance.service.ts`.

### Vì sao khác `retrievedChunksCount`?

`retrievedChunksCount` là số chunk Pinecone trả về. `relevantChunksCount` là số chunk vượt qua logic relevance của backend.

Ví dụ:

```text
Pinecone trả 8 chunks
Backend đánh giá 5 chunks relevant

retrievedChunksCount = 8
relevantChunksCount = 5
```

Chúng có thể khác nhau vì một chunk có thể được Pinecone trả về nhưng vẫn bị backend xem là yếu nếu:

- Pinecone score thấp hơn `0.3`
- Không có term overlap đáng kể với query
- `lexicalRelevanceScore` thấp hơn `relevanceThreshold`

### Nguồn metric

Backend heuristic dựa trên Pinecone score + lexical signal nhẹ.

## 5. `chunk.relevanceScore`

### Ý nghĩa

Điểm relevance cuối cùng của một chunk trong corrective RAG. Điểm này thể hiện backend đánh giá chunk liên quan tới câu hỏi đến mức nào.

### Sinh ở đâu?

`src/services/relevance.service.ts`

Function:

```ts
evaluateChunkRelevance(question, chunk, threshold)
```

### Công thức hiện tại

Backend lấy 2 loại điểm:

1. `pineconeScore`
2. `lexicalRelevanceScore`

Sau đó:

```ts
relevanceScore = round2(max(lexicalRelevanceScore, pineconeScore))
```

Chi tiết lexical:

```ts
questionTerms = normalized question terms, term length >= 3
chunkTerms = normalized chunk terms, term length >= 3
matchedTerms = questionTerms ∩ chunkTerms

coverageScore = matchedTerms.length / questionTerms.size
densityScore = min(matchedTerms.length / 8, 1)

lexicalRelevanceScore = round2(
  coverageScore * 0.75 + densityScore * 0.25
)
```

Pseudocode:

```text
pineconeScore = chunk.pineconeScore || 0

if questionTerms empty or chunkTerms empty:
  relevanceScore = 0
else:
  lexical = 0.75 * coverage + 0.25 * density
  relevanceScore = max(lexical, pineconeScore)
  relevanceScore = round to 2 decimals
```

### Vì sao có giá trị như `0.59`?

Một giá trị như `0.59` thường đến từ `Math.max(lexicalRelevanceScore, pineconeScore)` sau khi làm tròn 2 chữ số.

Ví dụ:

```text
pineconeScore = 0.58731
lexicalRelevanceScore = 0.42

relevanceScore = max(0.42, 0.58731)
relevanceScore = 0.59
```

Hoặc:

```text
pineconeScore = 0.31
lexicalRelevanceScore = 0.586

relevanceScore = 0.59
```

### Có phải Pinecone cosine similarity không?

Một phần có thể đến trực tiếp từ Pinecone score.

Trong `vector.service.ts`, Pinecone query trả:

```ts
pineconeScore: match.score
```

Backend không tự tính cosine similarity. Pinecone score phụ thuộc vào metric của Pinecone index, ví dụ cosine nếu index được tạo với cosine metric.

### Có normalize không?

Backend không normalize lại Pinecone score. Backend chỉ:

- lấy `match.score` từ Pinecone
- so sánh với lexical score
- lấy `max`
- làm tròn 2 chữ số bằng `toFixed(2)`

### Dữ liệu phụ thuộc

- `match.score` từ Pinecone
- nội dung câu hỏi
- nội dung chunk
- term overlap sau normalize text

### Nguồn metric

Pinecone score + backend heuristic.

## 6. `evaluation.averageRelevanceScore`

### Ý nghĩa

Điểm relevance trung bình của các chunk đã được evaluate.

### Sinh ở đâu?

`src/services/relevance.service.ts`

Function:

```ts
calculateAverageRelevance(chunks)
```

### Cách tính

```ts
if chunks.length === 0:
  return 0

average = sum(chunk.relevanceScore) / chunks.length
return round2(average)
```

### Basic vs Corrective

Basic:

```ts
averageRelevanceScore: chunks.length > 0 ? 1 : 0
```

Điều này có nghĩa là basic không có relevance evaluator thật. Nếu Pinecone trả chunks, basic coi score trung bình là `1`.

Corrective:

```ts
averageRelevanceScore = calculateAverageRelevance(evaluatedChunks)
```

Đây là average thực tế dựa trên `relevanceScore` của từng chunk.

### Nguồn metric

- Basic: backend default value.
- Corrective: backend heuristic dựa trên Pinecone score + lexical signal.

## 7. `evaluation.relevanceThreshold`

### Ý nghĩa

Ngưỡng relevance tối thiểu để chunk được chọn vào context cuối cùng trong corrective RAG.

### Sinh ở đâu?

`src/services/correctiveRag.service.ts`

Constant:

```ts
RAG_CONFIG.relevanceThreshold // default 0.55
```

### Cách hoạt động

Trong `selectAnswerChunks`:

```ts
chunks
  .filter((chunk) => chunk.relevanceScore >= RAG_CONFIG.relevanceThreshold)
  .sort((a, b) => b.relevanceScore - a.relevanceScore)
  .slice(0, maxChunks)
```

Nghĩa là chunk phải có `relevanceScore >= 0.55` mới được chọn vào answer context theo cấu hình mặc định, trừ khi fallback được kích hoạt. Ngưỡng cao hơn giúp tăng precision nhưng có thể giảm recall.

### Liên quan tới `isRelevant`

Trong `evaluateChunkRelevance`, chunk được đánh dấu `isRelevant` nếu:

```ts
pineconeScore >= 0.3
OR lexicalRelevanceScore >= threshold
```

và không bị xem là explicitly irrelevant.

Có 2 ngưỡng cần phân biệt:

- `PINECONE_RELEVANCE_THRESHOLD = 0.3`: ngưỡng Pinecone score tối thiểu để xem semantic match là đủ tốt.
- `RELEVANCE_THRESHOLD = 0.55`: ngưỡng relevanceScore để chọn vào final context trong corrective RAG.

Các ngưỡng được cấu hình tại `src/config/rag.config.ts` và có thể tune qua biến môi trường.

### Nguồn metric

Backend config/heuristic.

## 8. `evaluation.correctiveAttempted`

### Ý nghĩa

Cho biết corrective RAG có chạy retrieval lần hai hay không.

### Sinh ở đâu?

`src/services/correctiveRag.service.ts`

Function:

```ts
askQuestionWithCorrectiveRag
```

### Khi nào bật `true`?

Sau first-pass retrieval:

```ts
if (intent !== "extraction" && relevantChunks.length < MIN_RELEVANT_CHUNKS) {
  correctiveAttempted = true
  // rewrite stricter query
  // search Pinecone again
}
```

Với constants:

```ts
MIN_RELEVANT_CHUNKS = 3
```

Nghĩa là corrective retrieval lần hai chỉ chạy khi:

- intent không phải `extraction`
- số relevant chunks sau pass đầu nhỏ hơn `3`

### Vì sao extraction bị bỏ qua second pass?

Vì extraction thường cần trả lời ngắn, tập trung vào một vài facts/entities. Retrieve quá rộng có thể làm context nhiễu hơn.

### Nguồn metric

Backend control flow.

## 9. `evaluation.usedFallbackChunks`

### Ý nghĩa

Cho biết hệ thống có dùng fallback chunks hay không.

Fallback chunks là top chunks theo Pinecone score được dùng khi relevance evaluator quá nghiêm hoặc không chọn được chunk nào.

### Sinh ở đâu?

`src/services/correctiveRag.service.ts`

Functions:

- `getFallbackChunks`
- `askQuestionWithCorrectiveRag`

### Khi nào bật `true`?

Trường hợp 1:

```ts
if (evaluatedChunks.length > 0 && relevantChunks.length === 0) {
  usedFallbackChunks = true
  relevantChunks = getFallbackChunks(evaluatedChunks)
}
```

Trường hợp 2:

```ts
if (answerChunks.length === 0 && candidateAnswerChunks.length > 0) {
  usedFallbackChunks = true
  answerChunks = getFallbackChunks(candidateAnswerChunks)
}
```

### Fallback chọn chunk như thế nào?

```ts
getFallbackChunks(chunks):
  sort by pineconeScore descending
  take top 3
  mark isRelevant = true
```

### Vì sao cần fallback?

Vì semantic retrieval có thể đã lấy đúng chunk, nhưng evaluator heuristic có thể reject hết do lexical overlap thấp. Fallback giúp tránh tình trạng:

```text
Pinecone đã tìm thấy context gần nghĩa
nhưng backend trả "không tìm thấy thông tin"
```

### Nguồn metric

Backend control flow + Pinecone score sorting.

## 10. `evaluation.isGrounded`

### Ý nghĩa

Cho biết answer cuối cùng có được hỗ trợ bởi context retrieve được hay không.

### Sinh ở đâu?

`src/services/answerCheck.service.ts`

Function:

```ts
checkAnswerGrounding(answer, context)
```

Được gọi trong:

- `askQuestionWithRag`
- `askQuestionWithCorrectiveRag`

### Cách hoạt động

Backend gửi prompt cho Groq:

```text
You are evaluating whether an answer is grounded only in the provided context.
Return valid JSON only.
Expected JSON:
{
  "isGrounded": true,
  "confidenceScore": 0.0,
  "reason": "string"
}
```

Groq trả JSON. Backend parse JSON và tính:

```ts
isGrounded = Boolean(parsed.isGrounded) && confidenceScore >= 0.4
```

Nếu parse JSON fail:

```ts
isGrounded = false
confidenceScore = 0
warning = "Grounding check parse failed"
```

### Có phải Jina/Groq evaluation không?

Hiện tại grounding/self-check dùng Groq qua `generateGroqTextFromPrompt`.

Jina hiện được dùng cho embedding, không phải answer grounding.

### Nguồn metric

Groq evaluation + backend confidence threshold.

## 11. `evaluation.confidenceScore`

### Ý nghĩa

Điểm tự tin của grounding check, từ `0` đến `1`.

### Sinh ở đâu?

`src/services/answerCheck.service.ts`

### Cách tính

Groq trả `confidenceScore`, backend clamp về `[0, 1]`:

```ts
confidenceScore = Math.max(
  0,
  Math.min(1, Number(parsed.confidenceScore) || 0)
)
```

Sau đó `isGrounded` chỉ được true nếu:

```ts
parsed.isGrounded === true
AND confidenceScore >= 0.4
```

### Dữ liệu phụ thuộc

- answer do Groq sinh
- context được build từ selected chunks
- prompt grounding

### Nguồn metric

Groq evaluation, backend clamp và threshold.

## 12. `evaluation.responseTimeMs`

### Ý nghĩa

Thời gian xử lý request RAG tính bằng milliseconds.

### Sinh ở đâu?

- `src/services/rag.service.ts`
- `src/services/correctiveRag.service.ts`

### Cách tính

Ở đầu function:

```ts
const startedAt = Date.now();
```

Khi return:

```ts
responseTimeMs: Date.now() - startedAt
```

### Bao gồm những gì?

Bao gồm gần như toàn bộ thời gian trong RAG service:

- validate document nếu có `documentId`
- intent classification
- query rewrite
- embedding query
- Pinecone retrieval
- relevance evaluation
- Groq answer generation
- grounding check
- retry answer nếu ungrounded

Không bao gồm toàn bộ Express middleware trước khi vào service, và không bao gồm thời gian lưu chat history/evaluation log trong `chat.service.ts` sau khi RAG result đã return.

### Nguồn metric

Timing measurement trong backend.

## 13. `evaluation.detectedIntent`

### Ý nghĩa

Intent của câu hỏi user, ví dụ:

- `qa`
- `summary`
- `comparison`
- `extraction`
- `instruction`
- `list`
- `unknown`

### Sinh ở đâu?

`src/services/intentClassifier.service.ts`

Function:

```ts
classifyQuestionIntent(question)
```

Được gọi trong:

- `askQuestionWithRag`
- `askQuestionWithCorrectiveRag`
- `rewriteAcademicQuery`

### Cách tính hiện tại

Hiện tại intent detection là LLM-based, không còn regex-based.

Backend gửi prompt cho Groq yêu cầu trả JSON:

```json
{
  "intent": "qa | summary | comparison | extraction | instruction | list | unknown",
  "confidence": 0.0
}
```

Backend parse JSON, validate intent nằm trong danh sách hợp lệ, và clamp confidence về `[0, 1]`.

Nếu Groq lỗi hoặc parse fail, backend fallback:

```ts
intent = "unknown"
confidence = 0
```

### Dữ liệu phụ thuộc

- câu hỏi user
- Groq classification response

### Nguồn metric

Groq semantic classification + backend JSON parsing.

## 14. `evaluation.retrievedSections`

### Ý nghĩa

Danh sách section label xuất hiện trong chunks đã retrieve/evaluate.

### Sinh ở đâu?

Basic:

`src/services/rag.service.ts`

Corrective:

`src/services/correctiveRag.service.ts`, function `getRetrievedSections`.

### Cách tính

Backend lấy từ metadata của chunk:

```ts
chunk.metadata.inferredSection || chunk.metadata.section || ""
```

Sau đó:

```ts
unique non-empty values
```

### Sections được infer như thế nào?

Trong upload/reindex flow:

1. `splitTextIntoChunks` đọc text theo từng dòng.
2. `detectSectionFromHeading` kiểm tra dòng có giống heading không.
3. Nếu đúng, heading đó trở thành dynamic section label.
4. Các chunk sau đó mang metadata:

```ts
section
inferredSection
semanticSectionLabel
```

Heading detection dùng format heuristic:

- line ngắn
- uppercase ratio cao
- không kết thúc bằng dấu câu
- dòng đứng tương đối độc lập
- có content phía sau
- numbered heading pattern như `1.`, `1.1`, `Chapter 1`, `Section 2`

### Section metadata có ảnh hưởng retrieval không?

Hiện tại retrieval không boost theo section và không filter theo section.

Pinecone query filter chỉ gồm:

```ts
userId
documentId nếu có
subject nếu có
```

Vì vậy `retrievedSections` chủ yếu dùng để debug/giải thích source, không phải tín hiệu retrieval chính.

### Nguồn metric

Chunk metadata từ upload/reindex flow.

## 15. `chunk.chunkIndex`

### Ý nghĩa

Vị trí thứ tự của chunk trong tài liệu sau khi split text.

### Sinh ở đâu?

`src/utils/textSplitter.ts`

Function:

```ts
splitTextIntoChunks(text)
```

### Cách tính

Mỗi chunk được push vào array:

```ts
chunkIndex: chunks.length
```

Tức là chunk đầu tiên có index `0`, chunk thứ hai là `1`, ...

Khi upsert Pinecone, vector id dùng:

```ts
id: `${documentId}:${chunk.chunkIndex}`
```

### Dữ liệu phụ thuộc

- extracted PDF text
- section block splitting
- LangChain `RecursiveCharacterTextSplitter`
- `chunkSize = 1000`
- `chunkOverlap = 200`

### Nguồn metric

Backend metadata.

## 16. `correctiveAttempted`: khi nào retry retrieval?

Corrective retrieval lần hai được trigger khi:

```text
intent != extraction
AND relevantChunks sau pass đầu < 3
```

Pseudocode:

```text
firstPassChunks = Pinecone search(rewrittenQuery, topK=8)
evaluatedChunks = evaluate(firstPassChunks)
relevantChunks = chunks where isRelevant = true

if intent != extraction and relevantChunks.length < 3:
  correctiveAttempted = true
  stricterQuery = rewrite again
  secondPassChunks = Pinecone search(stricterQuery, topK=8)
  secondEvaluated = evaluate(secondPassChunks)
  evaluatedChunks = dedupe(first + second)
  relevantChunks = evaluatedChunks where isRelevant = true
```

Second-pass retrieval giúp hệ thống thử lại khi query ban đầu chưa retrieve đủ context tốt.

## 17. `retrievedChunksCount` vs `relevantChunksCount`

### `retrievedChunksCount`

Số lượng chunk có trong danh sách retrieve/evaluate.

### `relevantChunksCount`

Số lượng chunk được đánh dấu `isRelevant`.

### Vì sao có thể khác?

Vì Pinecone search là bước semantic retrieval rộng hơn, còn relevance evaluation là bước lọc.

Ví dụ corrective:

```text
Pinecone trả về 8 chunks
Backend đánh giá:
  5 chunks isRelevant = true
  3 chunks isRelevant = false

retrievedChunksCount = 8
relevantChunksCount = 5
```

### Filtering xảy ra ở đâu?

1. `evaluateRetrievedChunks` đánh dấu `isRelevant`.
2. `relevantChunks = evaluatedChunks.filter(chunk => chunk.isRelevant)`.
3. `selectAnswerChunks` lọc tiếp bằng:

```ts
chunk.relevanceScore >= RELEVANCE_THRESHOLD
```

Vì vậy số chunks dùng để generate answer có thể còn nhỏ hơn `relevantChunksCount`.

## 18. `isGrounded` và self-check hoạt động thế nào?

Sau khi Groq generate answer, backend không tin ngay. Backend gọi `checkAnswerGrounding(answer, context)`.

Nếu Groq nói answer không grounded, backend regenerate answer một lần với strict prompt:

```ts
if (!grounding.isGrounded) {
  answer = generateAnswerFromContext(..., strict = true)
  grounding = checkAnswerGrounding(answer, context)
}
```

Với extraction intent, backend gọi lại `generateEntityExtractionAnswer`.

Grounding check không query Pinecone nữa. Nó chỉ nhìn:

- `context`: chunks đã chọn
- `answer`: câu trả lời vừa sinh

Mục tiêu là phát hiện answer có claim nào không được context support.

## 19. Source của từng metric

| Field | Nguồn chính | Code |
|---|---|---|
| `retrievedChunksCount` | Pinecone result count / evaluated chunk count | `rag.service.ts`, `correctiveRag.service.ts` |
| `relevantChunksCount` | Backend relevance filter | `relevance.service.ts`, `correctiveRag.service.ts` |
| `averageRelevanceScore` | Average relevance score | `relevance.service.ts` |
| `correctiveAttempted` | Backend control flow | `correctiveRag.service.ts` |
| `isGrounded` | Groq grounding check + backend threshold | `answerCheck.service.ts` |
| `confidenceScore` | Groq grounding JSON + backend clamp | `answerCheck.service.ts` |
| `responseTimeMs` | Backend timing | `rag.service.ts`, `correctiveRag.service.ts` |
| `usedFallbackChunks` | Backend fallback control flow | `correctiveRag.service.ts` |
| `relevanceThreshold` | Backend config | `rag.config.ts`, `correctiveRag.service.ts` |
| `detectedIntent` | Groq semantic classifier | `intentClassifier.service.ts` |
| `retrievedSections` | Chunk metadata | `textSplitter.ts`, `documentSection.ts`, RAG services |
| `chunkIndex` | Chunk metadata | `textSplitter.ts` |
| `relevanceScore` | Pinecone score + backend lexical heuristic | `relevance.service.ts` |

## 20. How these metrics help evaluate Corrective RAG vs Basic RAG

Các metric này giúp so sánh Basic RAG và Corrective RAG ở nhiều góc độ:

### Retrieval quality

Nhìn vào:

- `retrievedChunksCount`
- `relevantChunksCount`
- `averageRelevanceScore`
- `relevanceScore` từng source

Nếu Corrective RAG có `averageRelevanceScore` cao hơn và sources đúng hơn, nghĩa là retrieval/filtering tốt hơn basic.

### Correction behavior

Nhìn vào:

- `correctiveAttempted`
- `usedFallbackChunks`
- `warning`

Nếu `correctiveAttempted = true`, hệ thống đã nhận ra first-pass retrieval chưa đủ tốt và thử retrieve lại.

Nếu `usedFallbackChunks = true`, nghĩa là evaluator có thể quá nghiêm hoặc semantic search đã có kết quả gần đúng nhưng relevance filter reject hết.

### Faithfulness / hallucination control

Nhìn vào:

- `isGrounded`
- `confidenceScore`

Corrective RAG tốt hơn nếu answer grounded hơn, confidence cao hơn, và ít phải regenerate strict mode.

### Performance

Nhìn vào:

- `responseTimeMs`

Corrective RAG thường chậm hơn basic vì có thêm:

- query rewrite
- relevance evaluation
- possible second-pass retrieval
- grounding/self-check

Khi thuyết trình, có thể nói:

```text
Basic RAG nhanh hơn nhưng ít kiểm soát hơn.
Corrective RAG chậm hơn nhưng có thêm cơ chế kiểm tra relevance, retry retrieval, fallback và grounding để giảm trả lời sai.
```

### Debugging document structure

Nhìn vào:

- `retrievedSections`
- `source.section`
- `source.inferredSection`
- `source.semanticSectionLabel`

Các field này giúp kiểm tra chunks được lấy đến từ phần nào của tài liệu. Tuy nhiên hiện tại section metadata không quyết định retrieval; retrieval chính vẫn dựa trên embedding và Pinecone semantic similarity.
