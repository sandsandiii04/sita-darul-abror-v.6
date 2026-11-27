import { 
  ExamMaterialSnapshot, 
  ExamPeriod, 
  ExamQuestion, 
  ExamQuestionSet,
  QuestionBankItem, 
  QuranPosition,
  UTSGenerationStrategy,
  UASGenerationStrategy
} from '../types';
import { utsQuestionGenerator, createPRNG, md5 } from './utsQuestionGenerator';
import { uasQuestionGenerator } from './uasQuestionGenerator';
import { quranService, comparePositions } from './quranService';

export class RemedialQuestionGenerator {
  /**
   * Helper: Key string untuk titik B (surah:ayah:word)
   */
  private makeBKey(pos: { surahNumber: number; ayahNumber: number; wordPosition: number }): string {
    return `${pos.surahNumber}:${pos.ayahNumber}:${pos.wordPosition}`;
  }

  /**
   * Helper: Normalisasi field soal original (mendukung camelCase maupun snake_case dari RPC row_to_json)
   */
  private normalizeOriginalQuestion(oq: any): {
    questionRole: string;
    pageNumber: number | null;
    answerStartSurah: number | null;
    answerStartAyah: number | null;
    answerStartWord: number | null;
    questionBankId: string | null;
  } {
    const answerStart = oq?.answerStart || oq?.answer_start;
    return {
      questionRole: oq?.questionRole || oq?.question_role || 'random',
      pageNumber: oq?.pageNumber ?? oq?.page_number ?? oq?.startPage ?? oq?.start_page ?? null,
      answerStartSurah: oq?.answerStartSurah ?? oq?.answer_start_surah ?? answerStart?.surahNumber ?? answerStart?.surah_number ?? null,
      answerStartAyah: oq?.answerStartAyah ?? oq?.answer_start_ayah ?? answerStart?.ayahNumber ?? answerStart?.ayah_number ?? null,
      answerStartWord: oq?.answerStartWord ?? oq?.answer_start_word ?? answerStart?.wordPosition ?? answerStart?.word_position ?? 1,
      questionBankId: oq?.questionBankId ?? oq?.question_bank_id ?? null
    };
  }

  /**
   * Helper: Validasi batas koordinat soal acak terhadap snapshot materi (selaras dengan SQL Gate 18/19)
   */
  private isWithinSnapshotBounds(
    promptStart: QuranPosition,
    answerEnd: QuranPosition,
    snapshot: ExamMaterialSnapshot
  ): boolean {
    const dir = snapshot.memorizationDirection || 'forward';
    if (dir !== 'backward') {
      if (
        promptStart.surahNumber < snapshot.startSurah ||
        (promptStart.surahNumber === snapshot.startSurah && promptStart.ayahNumber < snapshot.startAyah) ||
        answerEnd.surahNumber > snapshot.endSurah ||
        (answerEnd.surahNumber === snapshot.endSurah && answerEnd.ayahNumber > snapshot.endAyah)
      ) {
        return false;
      }
      return true;
    } else {
      if (
        promptStart.surahNumber > snapshot.startSurah ||
        (promptStart.surahNumber === snapshot.startSurah && promptStart.ayahNumber < snapshot.startAyah) ||
        answerEnd.surahNumber < snapshot.endSurah ||
        (answerEnd.surahNumber === snapshot.endSurah && answerEnd.ayahNumber > snapshot.endAyah)
      ) {
        return false;
      }
      return true;
    }
  }

  /**
   * FUNGSI 1: GENERATE PAYLOAD UTS REMEDIAL (5 SOAL, 5 ZONA, ANTI-REUSE)
   */
  public async generateUTSRemedialPayload(params: {
    period: ExamPeriod;
    snapshot: ExamMaterialSnapshot;
    originalQuestions: ExamQuestion[];
    strategy?: UTSGenerationStrategy;
    seed?: string;
    bankQuestions?: QuestionBankItem[];
  }): Promise<{
    questionsData: any[];
    seed: string;
    fingerprint: string;
  }> {
    const { 
      period, 
      snapshot, 
      originalQuestions = [], 
      strategy = 'hybrid', 
      bankQuestions = [] 
    } = params;

    if (snapshot.status !== 'finalized') {
      throw new Error('Materi UTS santri belum difinalisasi.');
    }

    if (period.examType !== 'uts') {
      throw new Error('Generator ini khusus untuk ujian remedial UTS.');
    }

    // 1. Kumpulkan data pengecualian dari UTS original (Anti-Reuse)
    const origBKeys = new Set<string>();
    const origBankIds = new Set<string>();

    for (const rawOq of originalQuestions) {
      const oq = this.normalizeOriginalQuestion(rawOq);
      if (oq.answerStartSurah && oq.answerStartAyah) {
        origBKeys.add(this.makeBKey({
          surahNumber: oq.answerStartSurah,
          ayahNumber: oq.answerStartAyah,
          wordPosition: oq.answerStartWord || 1
        }));
      }
      if (oq.questionBankId) {
        origBankIds.add(oq.questionBankId);
      }
    }

    // 2. Bentuk MaterialPath & 5 Zona
    const path = utsQuestionGenerator.buildMaterialPath(snapshot);
    if (path.nodes.length === 0) {
      throw new Error('INSUFFICIENT_UNIQUE_REMEDIAL_MATERIAL: Materi terlalu pendek untuk menghasilkan 5 soal remedial.');
    }

    const zones = utsQuestionGenerator.divideIntoZones(path);
    if (zones.length !== 5) {
      throw new Error('Pembagian zona gagal menghasilkan tepat 5 zona.');
    }

    const seed = params.seed || `seed_uts_rem_${period.id}_${snapshot.studentId}_${Date.now()}`;
    const prng = createPRNG(seed);
    const usedBKeys = new Set<string>();
    const questionsData: any[] = [];

    // 3. Bangkitkan 1 Soal per Zona
    for (let i = 0; i < 5; i++) {
      const zone = zones[i];
      const zoneNum = i + 1;
      let q: any = null;

      // Coba Bank Soal jika diizinkan
      if (strategy === 'hybrid' || strategy === 'bank_only') {
        const bankCandidates = bankQuestions.filter(bq => {
          if (bq.status !== 'active') return false;
          if (bq.questionType === 'mandatory') return false;
          if (bq.examType !== 'uts' && bq.examType !== 'generic') return false;
          if (origBankIds.has(bq.id)) return false;
          if (!bq.promptStart || !bq.promptEnd || !bq.answerStart || !bq.answerEnd) return false;
          if (
            comparePositions(bq.promptStart, bq.promptEnd) > 0 ||
            comparePositions(bq.promptEnd, bq.answerStart) >= 0 ||
            comparePositions(bq.answerStart, bq.answerEnd) > 0
          ) {
            return false;
          }
          if (!this.isWithinSnapshotBounds(bq.promptStart, bq.answerEnd, snapshot)) return false;

          const bKey = this.makeBKey(bq.answerStart);
          if (origBKeys.has(bKey) || usedBKeys.has(bKey)) return false;

          const inZone = zone.nodes.some(n => 
            n.surahNumber === bq.answerStart.surahNumber && 
            n.ayahNumber === bq.answerStart.ayahNumber
          );
          return inZone;
        });

        if (bankCandidates.length > 0) {
          const pickIdx = Math.floor(prng() * bankCandidates.length);
          const chosen = bankCandidates[pickIdx];
          const bKey = this.makeBKey(chosen.answerStart);
          usedBKeys.add(bKey);

          q = {
            questionNumber: zoneNum,
            zoneNumber: zoneNum,
            sourceType: 'bank',
            questionBankId: chosen.id,
            promptStartSurah: chosen.promptStart.surahNumber,
            promptStartAyah: chosen.promptStart.ayahNumber,
            promptStartWord: chosen.promptStart.wordPosition,
            promptEndSurah: chosen.promptEnd.surahNumber,
            promptEndAyah: chosen.promptEnd.ayahNumber,
            promptEndWord: chosen.promptEnd.wordPosition,
            answerStartSurah: chosen.answerStart.surahNumber,
            answerStartAyah: chosen.answerStart.ayahNumber,
            answerStartWord: chosen.answerStart.wordPosition,
            answerEndSurah: chosen.answerEnd.surahNumber,
            answerEndAyah: chosen.answerEnd.ayahNumber,
            answerEndWord: chosen.answerEnd.wordPosition,
            startPage: chosen.startPage,
            endPage: chosen.endPage,
            generatedMetadata: {
              source: 'bank',
              difficulty: chosen.difficulty,
              notes: chosen.notes
            }
          };
        }
      }

      // Jika bank_only dan tidak ketemu, gagal
      if (!q && strategy === 'bank_only') {
        throw new Error(`INSUFFICIENT_UNIQUE_REMEDIAL_MATERIAL: Tidak tersedia Bank Soal baru untuk Zona ${zoneNum}.`);
      }

      // Pembangkitan Otomatis (Auto Candidate) dengan proteksi anti-reuse
      if (!q) {
        let attempts = 0;
        const maxAttempts = Math.min(zone.nodes.length * 6, 40);

        while (attempts < maxAttempts) {
          attempts++;
          const targetNode = zone.nodes[Math.floor(prng() * zone.nodes.length)];
          const targetVerse = await quranService.getVerse(targetNode.surahNumber, targetNode.ayahNumber);
          const words = (targetVerse?.words || []).filter(w => w.charTypeName !== 'end');
          const totalWords = Math.max(1, words.length);

          const candidateWordPositions = [1];
          if (totalWords >= 6) {
            candidateWordPositions.push(Math.floor(totalWords / 2) + 1);
          }
          if (totalWords >= 12) {
            candidateWordPositions.push(Math.floor(totalWords * 0.75) + 1);
          }

          for (const candWord of candidateWordPositions) {
            const testBKey = `${targetNode.surahNumber}:${targetNode.ayahNumber}:${candWord}`;
            if (!origBKeys.has(testBKey) && !usedBKeys.has(testBKey)) {
              const pts = await utsQuestionGenerator.buildQuestionPoints(
                targetNode.surahNumber,
                targetNode.ayahNumber,
                candWord > 1 ? candWord : null,
                path,
                snapshot,
                prng
              );

              const currentBKey = this.makeBKey(pts.answerStart);
              const boundsOk = this.isWithinSnapshotBounds(pts.promptStart, pts.answerEnd, snapshot);
              const orderOk =
                comparePositions(pts.promptStart, pts.promptEnd) <= 0 &&
                comparePositions(pts.promptEnd, pts.answerStart) < 0 &&
                comparePositions(pts.answerStart, pts.answerEnd) <= 0;
              if (boundsOk && orderOk && !origBKeys.has(currentBKey) && !usedBKeys.has(currentBKey)) {
                usedBKeys.add(currentBKey);
                q = {
                  questionNumber: zoneNum,
                  zoneNumber: zoneNum,
                  sourceType: 'auto',
                  questionBankId: null,
                  promptStartSurah: pts.promptStart.surahNumber,
                  promptStartAyah: pts.promptStart.ayahNumber,
                  promptStartWord: pts.promptStart.wordPosition,
                  promptEndSurah: pts.promptEnd.surahNumber,
                  promptEndAyah: pts.promptEnd.ayahNumber,
                  promptEndWord: pts.promptEnd.wordPosition,
                  answerStartSurah: pts.answerStart.surahNumber,
                  answerStartAyah: pts.answerStart.ayahNumber,
                  answerStartWord: pts.answerStart.wordPosition,
                  answerEndSurah: pts.answerEnd.surahNumber,
                  answerEndAyah: pts.answerEnd.ayahNumber,
                  answerEndWord: pts.answerEnd.wordPosition,
                  startPage: pts.startPage,
                  endPage: pts.endPage,
                  generatedMetadata: pts.metadata
                };
                break;
              }
            }
          }

          if (q) break;
        }
      }

      if (!q) {
        throw new Error(`INSUFFICIENT_UNIQUE_REMEDIAL_MATERIAL: Materi tidak cukup untuk menghasilkan titik soal remedial baru pada Zona ${zoneNum}.`);
      }

      questionsData.push(q);
    }

    if (questionsData.length !== 5) {
      throw new Error(`Jumlah butir soal remedial UTS tidak tepat 5 (ditemukan ${questionsData.length}).`);
    }

    const fingerprint = utsQuestionGenerator.calculateMaterialFingerprint(snapshot);

    return {
      questionsData,
      seed,
      fingerprint
    };
  }

  /**
   * FUNGSI 2: GENERATE PAYLOAD UAS REMEDIAL (2 WAJIB + 7 ACAK, ANTI-REUSE)
   */
  public async generateUASRemedialPayload(params: {
    period: ExamPeriod;
    snapshot: ExamMaterialSnapshot;
    originalQuestions: ExamQuestion[];
    strategy?: UASGenerationStrategy;
    seed?: string;
    bankQuestions?: QuestionBankItem[];
  }): Promise<{
    questions: any[];
    seed: string;
    fingerprint: string;
  }> {
    const { 
      period, 
      snapshot, 
      originalQuestions = [], 
      strategy = 'hybrid', 
      bankQuestions = [] 
    } = params;

    if (snapshot.status !== 'finalized') {
      throw new Error('Materi UAS santri belum difinalisasi.');
    }

    if (period.examType !== 'uas') {
      throw new Error('Generator ini khusus untuk ujian remedial UAS.');
    }

    // 1. Kumpulkan data pengecualian dari UAS original (Anti-Reuse)
    const origMandatoryPages = new Set<number>();
    const origRandomBKeys = new Set<string>();
    const origBankIds = new Set<string>();

    for (const rawOq of originalQuestions) {
      const oq = this.normalizeOriginalQuestion(rawOq);
      if (oq.questionRole === 'mandatory' && oq.pageNumber) {
        origMandatoryPages.add(oq.pageNumber);
      } else if (oq.answerStartSurah && oq.answerStartAyah) {
        origRandomBKeys.add(this.makeBKey({
          surahNumber: oq.answerStartSurah,
          ayahNumber: oq.answerStartAyah,
          wordPosition: oq.answerStartWord || 1
        }));
      }
      if (oq.questionBankId) {
        origBankIds.add(oq.questionBankId);
      }
    }

    // 2. Bentuk MaterialPath
    const path = uasQuestionGenerator.buildMaterialPath(snapshot);
    if (path.nodes.length === 0) {
      throw new Error('INSUFFICIENT_UNIQUE_MANDATORY_POOL: Materi terlalu pendek untuk menghasilkan soal UAS remedial.');
    }

    const seed = params.seed || `seed_uas_rem_${period.id}_${snapshot.studentId}_${Date.now()}`;
    const prng = createPRNG(seed);

    // 3. PEMILIHAN 2 SOAL WAJIB DENGAN ANTI-REUSE (Prioritas Bank Soal -> Auto Fallback Halaman Penuh Mushaf)
    interface MandatoryPageCandidate {
      pageNumber: number;
      sourceType: 'bank' | 'auto';
      questionBankId: string | null;
      notes?: string;
    }

    const validCandidates: MandatoryPageCandidate[] = [];
    const candidatePageSet = new Set<number>();

    // 3a. Filter kandidat Bank Soal Wajib yang belum dipakai di UAS original
    const eligibleMandatoryBank = bankQuestions.filter(bq => {
      const isActive = (bq.status === 'active');
      const isMandatory = (bq.questionType === 'mandatory');
      const isExamMatch = (bq.examType === 'uas' || bq.examType === 'generic');
      const notUsedInOriginalBank = !origBankIds.has(bq.id);
      const pageNum = bq.pageNumber || bq.startPage;
      const notUsedInOriginalPage = pageNum ? !origMandatoryPages.has(pageNum) : false;

      return isActive && isMandatory && isExamMatch && notUsedInOriginalBank && notUsedInOriginalPage;
    });

    for (const c of eligibleMandatoryBank) {
      const pageNum = c.pageNumber || c.startPage;
      if (pageNum && !candidatePageSet.has(pageNum) && await uasQuestionGenerator.isFullPageEligible(pageNum, snapshot, path)) {
        candidatePageSet.add(pageNum);
        validCandidates.push({
          pageNumber: pageNum,
          sourceType: 'bank',
          questionBankId: c.id,
          notes: c.notes || `Soal Wajib Remedial Halaman ${pageNum}`
        });
      }
    }

    // 3b. Auto Fallback: Jika Bank Soal Wajib < 2 (lazim pada UAS Multi-Sesi dengan pilihan wajib manual),
    //     ambil halaman penuh yang 100% eligible langsung dari materi santri (mengecualikan halaman UAS original)
    if (validCandidates.length < 2 && strategy !== 'bank_only') {
      const distinctPages = Array.from(
        new Set(path.nodes.map(n => n.pageNumber).filter(p => p >= 1 && p <= 604))
      ).sort((a, b) => a - b);

      for (const pageNum of distinctPages) {
        if (origMandatoryPages.has(pageNum) || candidatePageSet.has(pageNum)) continue;
        if (await uasQuestionGenerator.isFullPageEligible(pageNum, snapshot, path)) {
          candidatePageSet.add(pageNum);
          validCandidates.push({
            pageNumber: pageNum,
            sourceType: 'auto',
            questionBankId: null,
            notes: `Soal Wajib Remedial (Auto Mushaf) Halaman ${pageNum}`
          });
        }
      }
    }

    if (validCandidates.length < 2) {
      throw new Error('INSUFFICIENT_UNIQUE_MANDATORY_POOL: Tidak tersedia minimal 2 halaman wajib baru yang sesuai dengan materi santri setelah mengecualikan halaman UAS original.');
    }

    // Pilih 2 halaman berbeda
    const pairsDifferentPage: [MandatoryPageCandidate, MandatoryPageCandidate][] = [];
    const pairsWithSpacing: [MandatoryPageCandidate, MandatoryPageCandidate][] = [];

    for (let i = 0; i < validCandidates.length; i++) {
      for (let j = i + 1; j < validCandidates.length; j++) {
        const p1 = validCandidates[i].pageNumber;
        const p2 = validCandidates[j].pageNumber;
        if (p1 !== p2) {
          pairsDifferentPage.push([validCandidates[i], validCandidates[j]]);
          if (Math.abs(p1 - p2) >= 2) {
            pairsWithSpacing.push([validCandidates[i], validCandidates[j]]);
          }
        }
      }
    }

    if (pairsDifferentPage.length === 0) {
      throw new Error('INSUFFICIENT_UNIQUE_MANDATORY_POOL: Tidak tersedia 2 halaman wajib baru dengan nomor halaman berbeda.');
    }

    const poolToChooseFrom = pairsWithSpacing.length > 0 ? pairsWithSpacing : pairsDifferentPage;
    const chosenIndex = Math.floor(prng() * poolToChooseFrom.length);
    const chosenMandatory = poolToChooseFrom[chosenIndex];
    const mandatoryPages = chosenMandatory.map(m => m.pageNumber);

    const questions: any[] = [];

    // Tambahkan 2 Soal Wajib (Q1 & Q2)
    for (let mIdx = 0; mIdx < 2; mIdx++) {
      const mb = chosenMandatory[mIdx];
      const pageNum = mb.pageNumber;
      const pageBoundary = await uasQuestionGenerator.getPageWordBoundary(pageNum);

      questions.push({
        questionNumber: mIdx + 1,
        questionRole: 'mandatory',
        zoneNumber: null,
        sourceType: mb.sourceType,
        questionBankId: mb.questionBankId,
        pageNumber: pageNum,
        maxScore: 15,
        promptStart: null,
        promptEnd: null,
        answerStart: {
          surahNumber: pageBoundary.startSurah,
          ayahNumber: pageBoundary.startAyah,
          wordPosition: pageBoundary.startWord,
          pageNumber: pageNum
        },
        answerEnd: {
          surahNumber: pageBoundary.endSurah,
          ayahNumber: pageBoundary.endAyah,
          wordPosition: pageBoundary.endWord,
          pageNumber: pageNum
        },
        startPage: pageNum,
        endPage: pageNum,
        metadata: {
          isFullPage: true,
          pageNumber: pageNum,
          startSurah: pageBoundary.startSurah,
          startAyah: pageBoundary.startAyah,
          endSurah: pageBoundary.endSurah,
          endAyah: pageBoundary.endAyah,
          notes: mb.notes || `Soal Wajib Remedial Halaman ${pageNum}`
        }
      });
    }

    // 4. PEMBAGIAN 7 ZONA STRATIFIKASI
    const zones = uasQuestionGenerator.divideIntoZones(path);
    if (zones.length !== 7) {
      throw new Error('Pembagian zona gagal menghasilkan tepat 7 zona.');
    }

    // 5. GENERATE 7 SOAL ACAK (Q3..Q9) DENGAN ANTI-REUSE
    const usedRandomB = new Set<string>();

    for (let zIdx = 0; zIdx < 7; zIdx++) {
      const zone = zones[zIdx];
      const zoneNumber = zIdx + 1;
      const questionNumber = zIdx + 3;
      let chosenRandom: any = null;

      // Cek Bank Soal jika diizinkan
      if (strategy === 'hybrid' || strategy === 'bank_only') {
        const bankCandidates = bankQuestions.filter(bq => {
          if (bq.status !== 'active') return false;
          if (bq.questionType !== 'random') return false;
          if (bq.examType !== 'uas' && bq.examType !== 'generic') return false;
          if (origBankIds.has(bq.id)) return false;
          if (!bq.promptStart || !bq.promptEnd || !bq.answerStart || !bq.answerEnd) return false;
          if (
            comparePositions(bq.promptStart, bq.promptEnd) > 0 ||
            comparePositions(bq.promptEnd, bq.answerStart) >= 0 ||
            comparePositions(bq.answerStart, bq.answerEnd) > 0
          ) {
            return false;
          }
          if (!this.isWithinSnapshotBounds(bq.promptStart, bq.answerEnd, snapshot)) return false;

          const bInZone = zone.nodes.some(n => 
            n.surahNumber === bq.answerStart.surahNumber && 
            n.ayahNumber === bq.answerStart.ayahNumber
          );
          if (!bInZone) return false;

          const bPage = bq.answerStart.pageNumber || bq.startPage;
          if (bPage && mandatoryPages.includes(bPage)) return false;

          const bKey = this.makeBKey(bq.answerStart);
          if (origRandomBKeys.has(bKey) || usedRandomB.has(bKey)) return false;

          return true;
        });

        if (bankCandidates.length > 0) {
          const pickIdx = Math.floor(prng() * bankCandidates.length);
          const cb = bankCandidates[pickIdx];
          const bKey = this.makeBKey(cb.answerStart);
          usedRandomB.add(bKey);

          chosenRandom = {
            questionNumber,
            questionRole: 'random',
            zoneNumber,
            sourceType: 'bank',
            questionBankId: cb.id,
            pageNumber: cb.startPage,
            maxScore: 10,
            promptStart: cb.promptStart,
            promptEnd: cb.promptEnd,
            answerStart: cb.answerStart,
            answerEnd: cb.answerEnd,
            startPage: cb.startPage,
            endPage: cb.endPage,
            metadata: {
              source: 'bank',
              difficulty: cb.difficulty,
              notes: cb.notes
            }
          };
        }
      }

      if (!chosenRandom && strategy === 'bank_only') {
        throw new Error(`INSUFFICIENT_UNIQUE_RANDOM_POOL: Zona ke-${zoneNumber} tidak memiliki Bank Soal acak baru yang valid.`);
      }

      // Pembangkitan Otomatis (Auto Candidate)
      if (!chosenRandom) {
        let candidateNodes = zone.nodes.filter(n => !mandatoryPages.includes(n.pageNumber));
        if (candidateNodes.length === 0) {
          candidateNodes = zone.nodes;
        }

        let attempts = 0;
        const maxAttempts = Math.min(candidateNodes.length * 4, 30);

        while (attempts < maxAttempts) {
          attempts++;
          const targetNodeIdx = Math.floor(prng() * candidateNodes.length);
          const targetNode = candidateNodes[targetNodeIdx];

          const pts = await uasQuestionGenerator.buildQuestionPoints(
            targetNode.surahNumber,
            targetNode.ayahNumber,
            null,
            path,
            snapshot,
            prng
          );

          const bKey = this.makeBKey(pts.answerStart);
          const boundsOk = this.isWithinSnapshotBounds(pts.promptStart, pts.answerEnd, snapshot);
          const orderOk =
            comparePositions(pts.promptStart, pts.promptEnd) <= 0 &&
            comparePositions(pts.promptEnd, pts.answerStart) < 0 &&
            comparePositions(pts.answerStart, pts.answerEnd) <= 0;
          if (boundsOk && orderOk && !origRandomBKeys.has(bKey) && !usedRandomB.has(bKey)) {
            usedRandomB.add(bKey);
            chosenRandom = {
              questionNumber,
              questionRole: 'random',
              zoneNumber,
              sourceType: 'auto',
              questionBankId: null,
              pageNumber: pts.startPage,
              maxScore: 10,
              promptStart: pts.promptStart,
              promptEnd: pts.promptEnd,
              answerStart: pts.answerStart,
              answerEnd: pts.answerEnd,
              startPage: pts.startPage,
              endPage: pts.endPage,
              metadata: pts.metadata
            };
            break;
          }
        }
      }

      if (!chosenRandom) {
        throw new Error(`INSUFFICIENT_UNIQUE_RANDOM_POOL: Zona ke-${zoneNumber} tidak memiliki kandidat soal acak baru setelah pengecualian UAS original.`);
      }

      questions.push(chosenRandom);
    }

    if (questions.length !== 9) {
      throw new Error(`Paket soal UAS remedial tidak lengkap: menghasilkan ${questions.length} soal (harus tepat 9).`);
    }

    const fingerprint = uasQuestionGenerator.calculateMaterialFingerprint(snapshot);

    return {
      questions,
      seed,
      fingerprint
    };
  }
}

export const remedialQuestionGenerator = new RemedialQuestionGenerator();
export default remedialQuestionGenerator;
