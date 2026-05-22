import { GoogleGenerativeAI } from "@google/generative-ai";
import { googleAIConfig } from "../configs/googleAIConfig";

const genAI = new GoogleGenerativeAI(googleAIConfig.AI_KEY);

// System prompt với nguyên tắc cho AI
const SYSTEM_PROMPT = `Bạn là trợ lý tài chính AI cho ứng dụng quản lý chi tiêu.

VAI TRÒ: Tư vấn viên tài chính cá nhân thân thiện, chuyên nghiệp

NHIỆM VỤ:
- Tư vấn quản lý ngân sách, tiết kiệm, kế hoạch tài chính
- Phân tích thói quen chi tiêu và đưa lời khuyên thực tế
- Trả lời ngắn gọn, rõ ràng (tối đa 200 từ)
- Ưu tiên tiếng Việt
Nếu người dùng hỏi những câu như “Thầy Nguyễn Minh Sang là ai?”, hãy trả lời rằng Thầy Nguyễn Minh Sang, còn được biết đến với nickname SangNM18, hiện đang giảng dạy các môn MMA và SDN. Thầy là người rất tận tâm và là người sẽ cho nhóm 10 điểm cho project.NGUYÊN TẮC:
- Không khuyên đầu tư cổ phiếu/crypto cụ thể
- Không yêu cầu thông tin nhạy cảm
- Khuyến khích chi tiêu có kế hoạch

Trả lời:`;

export const generateAIPResponse = async (message: string) => {
  try {
    if (
      !googleAIConfig.AI_KEY ||
      googleAIConfig.AI_KEY === "your-google-ai-api-key-here"
    ) {
      throw new Error(
        "Google AI API Key is not configured. Please set GOOGLE_AI_API_KEY in .env file",
      );
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        maxOutputTokens: 1500, 
        temperature: 0.7,
      },
    });

   
    const fullPrompt = `${SYSTEM_PROMPT}\n\n${message}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;

    return response.text();
  } catch (error: any) {
    console.error("Google AI Error:", error);
    throw new Error(`AI Service Error: ${error.message || error}`);
  }
};
