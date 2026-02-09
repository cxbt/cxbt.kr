+++
title = 'Base Knowledge for Internet(work)'
date = 2026-02-06T15:25:20+09:00
draft = true
+++

인터넷 데이터 수집을 하려는데, 기반 지식이 부족함을 느꼈다. GPT와 찾아보면서 내용을 정리해봤다.

> `cxbt.kr` 도메인이 있다. 특정 공격 그룹 캠페인에서 C2[^1]로 활용되어서 IOC[^2]로 등록되었고, 지속적인 모니터링이 필요하다. 어떤 데이터를 수집할 수 있을까?

## Data Model (Normalization Units)

나중에 데이터 정규화/조인을 편하게 하려면, "무엇을 하나의 엔티티로 볼 건지"를 먼저 정해두는 게 좋다.

- Registrable domain (eTLD+1[^3]): PSL[^4] 기반. 예) `example.co.uk`
- FQDN[^5]: 예) `a.b.example.co.uk`
- IP address (v4/v6)
- Prefix (CIDR[^6]): 예) `203.0.113.0/24`
- ASN[^7]
- Service endpoint: `proto://ip:port` (예: `tcp://1.2.3.4:22`)
- TLS[^8] identity: 인증서 fingerprint/serial + issuer + SAN[^9]
- HTTP identity: `(scheme, host, port, path)` + response fingerprint

## Data Collection

### Registrar

도메인 등록 정보를 본다.

- 실제 소유자(Registrant)는 프라이버시/대행 등록 때문에 숨겨져 있을 수 있다.
- 대신 비교적 의미 있는 변화 신호는 Registrar, Nameserver(NS[^10]), Status, 생성/만료일, RDAP[^11] 이벤트 등이다.
- 참고: RDAP는 모든 TLD[^29] registry가 제공하는 건 아니다(특히 ccTLD[^37]는 WHOIS[^15]만 제공하거나 RDAP 지원이 제한적인 경우가 있다). 이 글 작성 시점에 `cxbt.kr`은 RDAP로 조회해도 결과가 나오지 않아 WHOIS/레지스트리 정보를 함께 확인해야 했다.

### Forward DNS (FDNS[^38])

도메인(FQDN) -> IP(A/AAAA) 매핑을 확인한다.

방법: `dig`, `nslookup`

- 참고: `nslookup`은 빠르게 확인하기 좋지만 옵션/출력 제어가 제한적이고, `dig`는 서버 지정/플래그/레코드 타입 등 정밀한 질의와 디버깅에 유리하다.
- A/AAAA뿐만 아니라 CNAME 체인, TTL, NS, SOA, TXT도 같이 보면 변화 추적에 도움된다.[^12]
- GeoDNS/Anycast/CDN 때문에 "어느 리졸버/어느 지역에서 질의했는지"도 관측값의 일부로 저장하는 게 좋다.[^13]
- 관측 팁: `dig`는 기본적으로 내 로컬이 사용하는 recursive resolver에 질의한다. authoritative name server의 "설정값"을 직접 확인하려면 `dig @<authoritative-ns> <name> A`처럼 네임서버를 지정해서 보는 편이 낫다.
- 관측 팁: DNS는 캐시/전파 지연이 있으니 (질의 시각, 질의한 resolver, TTL)을 함께 저장해두면 변동 해석이 쉬워진다.

#### Public Suffix List (PSL)

도메인의 "registrable domain(eTLD+1)"를 계산하는 데 쓴다.

- 예: `foo.bar.example.co.uk`에서 registrable domain은 `example.co.uk`

### IP/ASN Registry (RIR[^14]/RDAP/WHOIS)

IP가 어느 RIR 자원(Org/Net/ASN)에 할당되어 있는지 본다.

방법: RDAP, WHOIS (ARIN/RIPE NCC/APNIC/LACNIC/AFRINIC)

- "소유"라기보다는 "등록(할당/관리)" 관점이라, 실제 라우팅(BGP[^16])과는 다를 수 있다.

### BGP (Routing)

IP prefix가 인터넷에서 어떻게 announce되고 있는지(Origin ASN 등)를 본다.

방법: RIPE RIS/Route Views[^17] 등

- Origin 변화, MOAS[^18], announce/withdraw 이벤트는 하이재킹/인프라 이동 탐지에 유용하다.

### Reverse DNS (rDNS[^19])

IP -> PTR[^20](역방향) 레코드를 확인한다.

- PTR은 필수 데이터가 아니라서 없는 경우도 흔하다. 다만 메일 서버는 스팸/신뢰도 이슈로 PTR이 사실상 요구되는 경우가 많다.
- PTR은 보통 IP를 가진 쪽(호스팅/ISP/조직)이 관리한다. A/AAAA와 1:1로 정합하진 않고 stale한 경우도 많다.

### TCP

IP가 제공하는 TCP 서비스를 확인한다.

이런 저런 서비스를 확인할 수 있다: SSH, SMB, Telnet, RDP, FTP, Mongo, Redis, CouchDB

#### Banner Grabbing

포트가 열려있다고 해서 "무슨 서비스인지/어떤 버전인지"가 바로 확정되는 건 아니라, 최소한의 프로토콜 대화로 서버가 내보내는 식별 문자열/응답(배너)을 수집한다.

- 수집 대상: 초기 greeting(예: SSH/FTP/SMTP), 에러 메시지/옵션 목록, TLS 핸드셰이크 결과(TLS 버전, 인증서, 협상 cipher), HTTP status/Server 헤더 등
- 방법: `nc`/`telnet`로 raw TCP 연결 후 읽기/쓰기, `nmap -sV`(서비스/버전 탐지), TLS는 `openssl s_client`로 handshake, 프로토콜별 최소 probe(예: SMTP `EHLO`, FTP `USER` 등)
- 주의: 일부 서비스는 클라이언트가 먼저 말을 걸어야 응답하며, STARTTLS[^22]처럼 평문으로 시작해 TLS 업그레이드가 필요할 수 있다. 또한 배너는 로드밸런서/프록시/보안 장비에서 가려지거나, 설정으로 숨김/위장될 수 있어서 오탐이 생길 수 있다.

#### HTTP

IP가 제공하는 TCP 서비스 중 웹 서비스(HTTP, HTTPS)를 확인한다.

방법: socket 또는 단순 `curl` (unbiased & controlled request)

- 관측을 비교(변화 탐지)하려면 요청 템플릿을 고정해야 한다. 예: (path, `Host`/SNI, User-Agent/Accept 등 헤더, redirect 처리, timeout, HTTP 버전, TLS 설정). 템플릿이 달라지면 "서비스가 바뀐 게 아니라 내가 다르게 요청해서" 결과가 달라진 걸로 오해할 수 있다.
- IP로 바로 붙으면 vhost/SNI[^21] 기본 사이트가 나와서 "도메인 기준 관측"이 깨질 수 있다.
- HTTPS는 SNI가 중요하고, HTTP는 `Host` 헤더가 중요하다.
- 그래서 스캐닝에서는 IP 기준 HTTP 수집(기본 vhost/인프라 fingerprint)과, 도메인 기준 HTTP 수집(해당 IP로 접속하되 `Host`/SNI를 도메인으로 지정해 실제 서비스 fingerprint)을 병행하는 게 좋다.
- CDN/WAF[^36] 같은 역방향 프록시 뒤에 origin(실서버)을 의도적으로 숨기는 구조도 많다. 이 경우 FDNS로 얻은 IP가 실서버가 아니라 edge일 수 있고, 관측 결과도 "edge 정책(지역/레이트리밋/봇 방어/캐시)" 영향을 크게 받는다. 그래서 가능하면 "edge에서 본 것"과 "origin에서 본 것"을 구분해서 저장/해석하는 편이 안전하다.

#### TLS (SSL)

TCP 서비스가 TLS(구 SSL)를 사용하는지 확인한다.

이런 저런 서비스의 TLS 활성화 여부를 확인할 수 있을 거다: IMAPS, POP3S (HTTPS는 언급했으니 제외)

방법: `openssl s_client`, `nmap`(ssl-cert/ssl-enum-ciphers), `testssl.sh`, `zgrab2` 등

- STARTTLS vs implicit TLS 구분이 필요하다.

### UDP

IP가 제공하는 UDP 서비스를 확인한다.

이런 저런 서비스를 확인할 수 있다: NetBIOS, DNS, NTP, IPMI, NAT-PMP, BACNet, SIP, SNMP, mDNS 등등

#### Probing

UDP는 TCP처럼 연결(handshake)이 없어서 "열려있나?"를 판정하려면 보통 프로토콜별 probe 패킷을 보내고 응답/부재를 해석해야 한다.

- 기본 해석: 정상 응답이 오면 open일 가능성이 높고, ICMP Port Unreachable이 오면 closed로 볼 수 있다. 다만 무응답은 open/filtered/레이트리밋/드롭 등 여러 원인이 섞여서 단정하기 어렵다(스캐너가 `open|filtered`로 취급하는 이유).
- 그래서 프로토콜별로 "최소한의 유효한 질의"를 보내야 한다. 랜덤 payload는 서비스가 무시하거나, 방화벽/IPS에서 드롭될 수 있다.
- 관측 팁: (probe payload, 타임아웃, 리트라이 횟수, 소스 IP/관측 위치)를 함께 저장해두면 결과 해석이 쉬워진다. UDP는 ICMP rate limiting 때문에 스캔 조건에 따라 결과가 흔들릴 수 있다.

- mDNS/NetBIOS 같은 건 원래 로컬 브로드캐스트/멀티캐스트 성격이라, 인터넷에서 보이면 보통 오구성/노이즈일 가능성이 크다.
- UDP는 스푸핑/반사 같은 이슈가 있어 관측과 해석을 보수적으로 하는 편이 좋다.

### Passive / Third-party Signals

직접 스캔/질의한 관측(active) 말고도 쓸만한 신호들이 있다.

- Passive DNS(pDNS)[^23]: 과거 해석/변화를 보는 데 유용 (관측 기반이라 "권위(authoritative)"는 아님)
- Certificate Transparency(CT)[^24]: 도메인 관련 인증서 발급 이력(SAN 포함)으로 서브도메인/인프라 단서가 생긴다.
- Reputation/IOC: 블록리스트/신고/분석 리포트 등에서 재등장 여부, 컨텍스트를 확인한다.

### Scan Metadata

수집 데이터 자체만큼이나 "어떻게/어디서/어떤 조건으로" 수집했는지가 중요하다. 재현/디버깅/변화 탐지를 위해 최소한 아래는 같이 저장하는 편이 좋다.

- 공통 메타데이터: 관측 시각, 관측 지점(vantage) / 소스 IP(또는 ASN/지역), 대상(도메인/IP/포트), 사용한 툴/버전, 요청/프로브 템플릿 버전, timeout/retry/rate limit, 실패 사유(타임아웃/리셋/차단/해석 실패 등)
- HTTP 메타데이터: (scheme/host/port/path), 사용한 `Host`/SNI, 주요 헤더(User-Agent/Accept 등), redirect 정책, 응답 크기 상한(캡처 제한) 등
- DNS 메타데이터: 질의한 resolver/authoritative 서버, query type, EDNS 옵션 유무, TTL, DNSSEC[^25] 옵션, 캐시 여부(추정) 등

운영/윤리 관점에서도 기본 원칙을 정해두는 게 좋다.

- 레이트리밋/재시도 정책을 명시하고, 실패를 무한 재시도로 증폭시키지 않는다.
- 스캐닝 출처를 식별 가능하게 한다(예: rDNS/웹페이지로 목적/연락처 안내) + 차단/opt-out 요청은 빠르게 반영한다.
- 수집 데이터는 목적 범위 내에서 최소화하고(특히 바디/콘텐츠), 보관 기간/접근 통제를 정한다.

## Data Provenance (Authority & Observation)

데이터 소스 별로 겹치는 파트가 되게 많다. 각 데이터 소스가 어떤 Authority를 가지고 있고, 어떤 의존성을 가지고 있는지에 대해 분석한다.

### Who Controls What (Governance Map)

수많은 단체가 각 데이터를 유지하고 있다. 복잡한 세상이다. 데이터에 대한 현 시점에서의 거버넌스와 정책을 정리해보자.

여기서는 두 가지를 분리해서 생각한다.

- Authority: 최종적으로 "누가 설정/발급/위임할 수 있는가?"
- Observation: 나는 "어디서/어떤 방식으로 관측했는가?" (관측 위치/리졸버/요청 템플릿에 따라 달라질 수 있음)

#### Baseline: 수집 데이터 목록(권장)

- Domain registration (Registrar/Registry): 도메인 RDAP/WHOIS 이벤트, Registrar/NS 변경, 상태 코드, 만료/갱신 정보
- DNS (Authoritative): NS/SOA/A/AAAA/CNAME/TXT, TTL, DNSSEC(DS/DNSKEY) 신호
- DNS (Recursive/Resolver-view): 특정 리졸버(지역/사업자)에서의 해석 결과
- IP/ASN registry: IP/ASN RDAP(할당/관리), Org/Net 정보
- Routing (BGP): prefix announcement, origin ASN, 경로 변화(collector 관측)
- Reverse DNS: PTR + reverse zone delegation
- Service exposure (TCP/UDP): 포트 오픈/배너/프로토콜 특성
- TLS: 인증서 체인, SAN, issuer, validity, handshake 지표(버전/ALPN[^26]/cipher)
- HTTP: (Host/SNI 포함) 응답 fingerprint(상태/헤더/바디 해시/리다이렉트 체인)
- Passive/third-party: pDNS, CT, 평판/IOC 등

#### 누가 무엇을 관리하나(구조)

- Domain registration: ICANN[^27]/IANA[^28](최상위 정책/루트) -> TLD Registry(예: `.kr`) -> Registrar(등록대행) -> Registrant(실사용자/조직). RDAP은 registry/registrar 중 한 쪽이 제공하며, 프라이버시 등록이면 소유자 정보는 비어 있을 수 있다.
- DNS: Root zone은 IANA(관리)/Root server operators(서빙), TLD zone은 레지스트리, 2nd-level 이하 zone은 도메인 운영자(또는 managed DNS 공급자)가 authoritative name server에서 관리한다. DNSSEC이면 `DS(부모)` -> `DNSKEY(자식)` 체인으로 위임/검증이 연결된다.
- Recursive resolver view: Public resolver/ISP resolver 사업자가 캐시/정책/지역화를 적용할 수 있어 "authority"가 아니라 "관측값"이다.
- IP/ASN registry: IANA -> RIR -> (NIR/LIR[^30]) -> End user. RDAP/WHOIS는 이 할당/등록 관점의 권위 데이터다.
- Routing (BGP): 각 AS[^31] 운영자가 prefix를 announce/withdraw한다. RIPE RIS/Route Views는 그 라우팅을 관측해서 제공하는 collector다(관측 편향 존재). RPKI/ROA[^32]는 RIR이 인프라를 운영하고, 자원 보유자가 origin을 서명할 수 있게 한다.
- Reverse DNS: `in-addr.arpa`/`ip6.arpa` 위임은 IANA->RIR->할당 받은 조직/호스팅으로 내려가고, PTR 레코드는 실제 IP 운영자가 설정한다(부정확/미갱신 가능).
- TLS/Certificates: 도메인 운영자는 CA[^33]에 인증서를 요청한다. CA는 브라우저/OS Root Program[^34] 정책과 CA/B Forum[^35] 기준의 영향을 받는다. CT log는 발급된 인증서를 append-only로 공개 기록한다(운영 주체는 여러 곳: Google, Cloudflare, DigiCert 등).
- Service/TLS/HTTP: 최종 운영 주체는 서버/인프라 운영자(또는 CDN/WAF/호스팅)다. 스캐너는 그 순간의 표면을 관측하는 것이라, 시간/지역/요청에 따라 값이 달라질 수 있다.
- Passive/third-party: pDNS/CT/평판은 각 제공자가 자기 vantage와 수집 정책으로 만든 2차 데이터다. "없다(미관측)"와 "없음(부재)"를 혼동하면 안 된다.

##### Example: `.kr` (Korea ccTLD)

`.kr`은 ccTLD라서, 보통 gTLD처럼 ICANN과의 레지스트리 계약 구조를 그대로 따라가기보다는 "IANA 루트존 위임 + 로컬 정책/법"으로 운영되는 쪽에 가깝다. 실제로 무엇이 "권위"인지 확인할 때는 IANA 루트존의 위임 기록과, ccTLD 운영 주체가 공개하는 정책 문서를 같이 보는 게 안전하다.

- IANA Root Zone Database의 `.kr` 위임 기록에는 ccTLD manager로 KISA가, administrative contact로 KRNIC가 표시된다. (이 시점의 공식 위임/연락 창구)
- 같은 기록에 WHOIS 서버(`whois.kr`)와 등록 서비스 URL(`nic.or.kr`), `.kr` 네임서버(`*.dns.kr`)가 포함되어 있어 "무엇을 기준으로 authoritative DNS/WHOIS를 잡을지" 힌트가 된다.
- KRNIC 쪽 문서에서는 KISA가 등록 업무를 수행하고, KISA가 "Authorized Agency/Registrar"를 인가(accredit)해서 등록 서비스를 대행하게 하는 구조를 설명한다.
- KRNIC 정책/약관 문서에는 등록/관리 규칙이 "Act on Internet Address Resources"에 따라 운영된다고 명시되어 있고, 개정 규칙이 과학기술정보통신부(Minister of Science and ICT) 승인으로 발효된다는 부칙이 포함되어 있다. (정책의 최종 상위 근거)
- KRNIC 규칙 문맥에서 2단계(예: `example.kr`)와 3단계(예: `example.co.kr`)가 구분되어 언급된다. (네임스페이스/자격 요건/등록 정책이 달라질 수 있는 포인트)

참고 링크:
- [IANA Root Zone Database: `.KR`](https://www.iana.org/domains/root/db/kr.html)
- [KRNIC: Domain Registration](https://krnic.or.kr/jsp/eng/domain/registration/registration.jsp)
- [KRNIC: Terms and Conditions](https://krnic.or.kr/jsp/eng/domain/policy.jsp)

#### (요약) Authority 성격

- Authoritative DNS: "현재 설정"에 가장 가깝다. 다만 같은 도메인이라도 질의자(리졸버)의 IP/지역/네트워크에 따라 서로 다른 응답을 주도록(authoritative DNS에서 view를 분리해서) 운영할 수 있다(예: 내부/외부 분리, GeoDNS). 그래서 authoritative DNS 결과도 "어디서 어떤 리졸버로 질의했는지"를 같이 기록하는 게 안전하다.
- pDNS: "누군가 관측한 기록"이라 변화 추적에 강하지만, 누락/편향이 있다.
- RIR RDAP/WHOIS: "등록" 관점의 권위 데이터 (라우팅과 다를 수 있음)
- BGP: "인터넷 라우팅 현실"을 반영하지만, 하이재킹/누출/정책 이슈가 섞인다.
- rDNS(PTR): 운영/호스팅 쪽 설정이라 부정확할 수 있다.
- HTTP/TLS 스캔: "그 시점의 응답"이라 시간/지역/요청에 따라 달라질 수 있다.

## Data Translation

그래서 이걸로 뭘 판단할 수 있는가?

- BGP 하이재킹: BGP 관측(RIS/Route Views 등)에서 prefix의 origin/경로 변화, 갑작스러운 announce/withdraw를 추적한다. 목적은 트래픽 리다이렉션/가로채기/블랙홀로 인한 통신 실패나 중간자 위험을 조기에 탐지하는 것이다.
- HTTP 서비스에서의 변동: 동일한 요청 템플릿(Host/SNI, 헤더 등)으로 주기적으로 fetch하고 status/redirect/헤더/바디 fingerprint를 비교한다. 목적은 C2 페이지 교체, sinkhole/차단, 피싱 전환 같은 "의미 있는 서비스 상태 변화"를 포착하는 것이다.
- 인프라 이동: DNS 해석/NS, IP/ASN 등록정보(RDAP), BGP origin, TLS/CT 신호, 포트 노출을 묶어서 "같은 운영 주체가 어디로 옮겨갔는지"를 추적한다. 목적은 IOC가 바뀌어도(새 IP/도메인/ASN) 연관성을 유지해서 모니터링 범위를 따라가는 것이다.
- TLS 인증서 변동(issuer/validity/SAN) 및 CT 기반 신규 서브도메인 단서: 주기적으로 인증서 fingerprint/SAN/issuer 변화를 기록하고 CT 로그에서 새 발급을 탐색한다. 목적은 신규 서브도메인/호스트를 발굴하거나, 재발급/교체로 인한 인프라 변경 신호를 빠르게 잡는 것이다.
- DNS NS 변경 / 도메인 만료/이전 같은 운영 이벤트: Registrar/RDAP 이벤트와 NS/SOA 변화를 모니터링해 소유권/위임 변경을 감시한다. 목적은 도메인 drop/이전/탈취나 정책 변경으로 인한 관측 왜곡(응답 급변, sinkhole 등)을 구분하는 것이다.
- 신규 포트/서비스 노출(또는 닫힘) 같은 표면적 변화: TCP/UDP 스캔과 배너/프로토콜 fingerprint를 주기적으로 비교한다. 목적은 원격관리 채널 추가, DB 노출, 방화벽 정책 변경 같은 공격 표면 변화를 탐지해 후속 분석/대응 우선순위를 잡는 것이다.

## Precedents of Similar Actions

이 짓을 아무도 안했을까? 그럴리가

약간 데이터 수집의 성격과 목적이 다른 느낌은 있지만, 일단 리스트업 해보자면 아래와 같다.

- [Rapid7 Project Sonar](https://www.rapid7.com/research/project-sonar/)
- [Cisco ThousandEyes](https://www.thousandeyes.com/ko-kr/)
- [RIPE Atlas](https://atlas.ripe.net/)
- [CAIDA](https://www.caida.org/)
- [ZMap Project](https://zmap.io/)
- 기타 상용 혹은 무료 플랫폼
  - [Censys](https://search.censys.io/)
  - [FOFA](https://en.fofa.info/)
  - [Shodan](https://www.shodan.io/dashboard)

돈 내고 데이터를 보라니, 이게 ㄹㅇ 창조 경제 아니냐? 당장 만들어

[^1]: C2 (Command and Control). 공격자가 악성코드/봇을 원격 제어하기 위한 통신 채널 또는 서버를 말한다.
[^2]: IOC (Indicator of Compromise). 침해 흔적 지표로, 도메인/IP/URL/파일 해시 등 탐지에 쓰는 단서를 말한다.
[^3]: eTLD+1 (effective TLD + 1). PSL 기준으로 계산한 "등록 가능한 최상위 도메인 + 1" (registrable domain)이다.
[^4]: PSL (Public Suffix List). `co.uk`처럼 "public suffix"를 판별하기 위해 사용하는 규칙/목록이다.
[^5]: FQDN (Fully Qualified Domain Name). DNS에서 계층을 끝까지 포함한 완전한 도메인 이름을 말한다.
[^6]: CIDR (Classless Inter-Domain Routing). IP prefix 표기법(`203.0.113.0/24`)과 주소 할당/라우팅 방식이다.
[^7]: ASN (Autonomous System Number). BGP에서 AS를 식별하는 번호다.
[^8]: TLS (Transport Layer Security). 통신을 암호화하는 프로토콜이다. SSL은 TLS의 전신 용어로, 실무에서 관성적으로 같이 부르기도 한다.
[^9]: SAN (Subject Alternative Name). TLS 인증서가 커버하는 도메인/호스트 이름 목록이다.
[^10]: NS (Name Server). 특정 DNS zone에 대한 authoritative name server를 가리키는 레코드/역할이다.
[^11]: RDAP (Registration Data Access Protocol). IP/ASN/도메인 등록 데이터를 HTTPS/JSON으로 조회하는 WHOIS 후속 프로토콜이다. 다만 TLD/레지스트리(ccTLD 등)에 따라 RDAP를 제공하지 않거나, 제공하더라도 정책/구현 차이로 조회 경험이 들쭉날쭉할 수 있다.
[^12]: A/AAAA/CNAME/TTL/NS/SOA/TXT. 대표적인 DNS 레코드 타입들이다: A(IPv4), AAAA(IPv6), CNAME(alias), TTL(cache 유효기간), NS(위임), SOA(zone 권한/시작), TXT(텍스트 메타데이터).
[^13]: GeoDNS/Anycast/CDN. GeoDNS는 질의 위치/리졸버에 따라 다른 응답을 주는 형태, Anycast는 여러 노드가 같은 IP로 응답하는 형태, CDN은 지역 분산 캐시/프록시로 트래픽을 처리하는 서비스다.
[^14]: RIR (Regional Internet Registry). 지역 단위로 IP/ASN 자원 등록/배분을 담당하는 조직이다. 5개 RIR은 ARIN(북미), RIPE NCC(유럽 등), APNIC(아태), LACNIC(중남미), AFRINIC(아프리카)이다.
[^15]: WHOIS. 등록(할당) 정보를 텍스트 기반으로 조회하는 레거시 프로토콜/서비스를 말한다.
[^16]: BGP (Border Gateway Protocol). AS 간에 IP prefix 경로를 교환하는 인터넷 라우팅 프로토콜이다(announce/withdraw).
[^17]: RIPE RIS / Route Views. 여러 관측 지점에서 BGP 테이블/업데이트를 수집해 공개하는 라우팅 데이터 컬렉터다.
[^18]: MOAS (Multiple Origin AS). 동일 prefix가 여러 ASN을 origin으로 announce되는 상태를 말한다(정상/비정상 둘 다 가능).
[^19]: rDNS (reverse DNS). IP -> 도메인(PTR) 매핑을 위한 DNS 영역(예: `in-addr.arpa`, `ip6.arpa`)을 말한다.
[^20]: PTR (Pointer). reverse DNS에서 IP에 대응하는 이름을 지정하는 레코드 타입이다.
[^21]: vhost/`Host`/SNI. 한 IP/포트에서 여러 도메인을 서비스할 때, HTTP는 `Host` 헤더로, TLS는 SNI(Server Name Indication)로 대상 도메인을 선택하는 경우가 많다.
[^22]: STARTTLS vs implicit TLS. implicit TLS(TLS-on-connect)는 TCP 연결 직후 바로 TLS ClientHello로 시작한다. STARTTLS는 평문 프로토콜로 배너/기능 협상을 한 뒤, 해당 프로토콜이 정의한 명령(예: SMTP `STARTTLS`, POP3 `STLS`, IMAP `STARTTLS`, FTP `AUTH TLS`)으로 "TLS로 전환"을 합의하고 같은 연결에서 TLS 핸드셰이크를 시작한다. 스캐너 구현 관점에서 STARTTLS는 프로토콜별 최소 state machine이 필요하고, 단순히 TLS를 바로 시도하거나 `STARTTLS` 문자열만 던져서는 실패할 수 있다.
[^23]: pDNS (Passive DNS). 여러 관측 지점에서 수집된 "해석 기록" 데이터다. authoritative 설정이 아니라 관측 기반이라 누락/편향이 있다. 공개 다운로드 형태의 대규모 덤프는 드물고, 보통은 API/계약 기반으로 제공된다(예: CIRCL Passive DNS, VirusTotal, RiskIQ/PassiveTotal 등). 완전한 pDNS가 필요 없고 "과거 DNS 상태"가 목적이면, 공개 Active DNS 측정(예: Project Sonar) 같은 대체재도 고려할 수 있다.
[^24]: CT (Certificate Transparency). 인증서 발급 내역을 공개 로그에 append-only로 기록하는 체계다(서브도메인 단서로 유용).
[^25]: DNSSEC/DS/DNSKEY. DNS 응답의 무결성을 서명으로 검증하는 확장이다. DS는 부모->자식 위임용 해시, DNSKEY는 존의 공개키다.
[^26]: ALPN (Application-Layer Protocol Negotiation). TLS 핸드셰이크에서 HTTP/2 같은 애플리케이션 프로토콜을 협상하는 확장이다.
[^27]: ICANN (Internet Corporation for Assigned Names and Numbers). 도메인/번호자원 관련 글로벌 정책/조정 기구다(특히 gTLD 생태계).
[^28]: IANA (Internet Assigned Numbers Authority). 루트존/TLD 위임, 프로토콜 파라미터 등 인터넷 핵심 레지스트리를 관리하는 역할이다.
[^29]: TLD (Top-Level Domain). `.com`, `.kr` 같은 최상위 도메인이다.
[^30]: NIR/LIR. NIR(National Internet Registry) 또는 LIR(Local Internet Registry)로, RIR로부터 자원을 받아 하위에 재배분/관리하는 조직을 말한다.
[^31]: AS (Autonomous System). 하나의 라우팅 정책 하에 운영되는 네트워크 단위로, BGP에서 ASN으로 식별된다.
[^32]: RPKI/ROA. RPKI는 자원 보유자가 prefix-ASN 매핑을 서명할 수 있게 하는 체계이고, ROA(Route Origin Authorization)는 "이 prefix는 이 ASN이 origin"이라는 서명 객체다.
[^33]: CA (Certificate Authority). TLS 인증서를 발급하는 기관이다. 예: DigiCert, GlobalSign, Sectigo(구 Comodo CA), Entrust, Let's Encrypt(ISRG), GoDaddy, Google Trust Services, Amazon Trust Services, VeriSign 등.
[^34]: Root Program. 브라우저/운영체제가 어떤 CA를 기본 신뢰할지(루트 스토어)를 결정하는 정책/프로그램을 말한다.
[^35]: CA/B Forum (Certificate Authority/Browser Forum). CA와 브라우저 벤더가 인증서 정책/표준(Baseline Requirements 등)을 논의하는 산업 협의체다.
[^36]: CDN/WAF. CDN(Content Delivery Network)은 캐시/프록시로 트래픽을 분산 처리하는 서비스이고, WAF(Web Application Firewall)는 웹 요청을 필터링/차단하는 보안 장비/서비스다.
[^37]: ccTLD/gTLD. ccTLD(country-code TLD)는 국가 코드 최상위 도메인(예: `.kr`), gTLD(generic TLD)는 일반 최상위 도메인(예: `.com`)을 말한다.
[^38]: FDNS (Forward DNS). 도메인 이름 -> IP(A/AAAA) 해석(정방향)을 의미한다. rDNS는 IP -> 이름(PTR)이다.
