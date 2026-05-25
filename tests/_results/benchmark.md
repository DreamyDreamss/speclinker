# Speclinker 회귀 매트릭스 보고서

**fixture 7종 / probe 평균 1.0 / call_chain 평균 1.0**

## 요약

| fixture | probe | call_chain | strategy 추가 follow |
|---------|-------|------------|----------------------|
| `django-drf` | 3/3 (1.00) | 2/2 (1.00) | +5 |
| `fastapi-sqlalchemy` | 3/3 (1.00) | 2/2 (1.00) | - |
| `go-gin-gorm` | 3/3 (1.00) | ⊘ no call_chain_expectation | +4 |
| `nestjs-prisma` | 3/3 (1.00) | 2/2 (1.00) | - |
| `spring-jpa-hexagonal` | 4/4 (1.00) | 3/3 (1.00) | +5 |
| `spring-mybatis-ntier` | 5/5 (1.00) | 3/3 (1.00) | - |
| `vue-fsd` | 3/3 (1.00) | 2/2 (1.00) | +11 |

## fixture 별 세부

### `django-drf` — Django + DRF (ViewSet 기반) + django-orm. N-Tier 풍 (views→services→repositories→models).

**probe**:
- ✓ backend_lang
- ✓ backend_framework
- ✓ persistence

**call_chain**:
- service=1, dao=1, query=0, total=2
- ✓ service_must_resolve_to
- ✓ dao_must_resolve_to

**strategy 합성 (DEFAULT 대비)**:
- follow_added: `managers, repositories, selectors, services, views`
- skip_added: `domain, entity, migrations, model, serializers`
- max_depth: 3

### `fastapi-sqlalchemy` — FastAPI + SQLAlchemy 표준 layered (routers → services → repositories → models)

**probe**:
- ✓ backend_lang
- ✓ backend_framework
- ✓ persistence

**call_chain**:
- service=1, dao=1, query=0, total=2
- ✓ service_must_resolve_to
- ✓ dao_must_resolve_to

### `go-gin-gorm` — Go + Gin (REST 라우터) + GORM (ORM). N-Tier (handler→service→repository).

**probe**:
- ✓ backend_lang
- ✓ backend_framework
- ✓ persistence

**strategy 합성 (DEFAULT 대비)**:
- follow_added: `handler, handlers, repositories, services`
- skip_added: `domain, entity, middleware, model`
- max_depth: 3

### `nestjs-prisma` — NestJS + Prisma 단일 도메인 폴더 (Controller·Service·Repository 동일 디렉토리)

**probe**:
- ✓ backend_lang
- ✓ backend_framework
- ✓ persistence

**call_chain**:
- service=1, dao=1, query=0, total=2
- ✓ service_must_resolve_to
- ✓ dao_must_resolve_to

### `spring-jpa-hexagonal` — Hexagonal Architecture (adapter/in.web → application/service → domain + adapter/out.persistence)

**probe**:
- ✓ backend_lang
- ✓ backend_framework
- ✓ persistence
- ✓ architecture_hint

**call_chain**:
- service=1, dao=2, query=0, total=3
- ✓ service_must_resolve_to
- ✓ dao_must_resolve_to
- ✓ domain_must_resolve_to

**strategy 합성 (DEFAULT 대비)**:
- follow_added: `application, domain, interactor, repositories, usecase`
- max_depth: 4

### `spring-mybatis-ntier` — 전통적 N-Tier (Controller→Service→DAO→MyBatis XML)

**probe**:
- ✓ backend_lang
- ✓ backend_framework
- ✓ persistence
- ✓ frontend_framework
- ✓ architecture_hint

**call_chain**:
- service=1, dao=1, query=1, total=3
- ✓ service_must_resolve_to
- ✓ dao_must_resolve_to
- ✓ query_must_resolve_to

### `vue-fsd` — Vue 3 + Vue Router + Pinia + FSD 슬라이스 (pages/features/entities/shared)

**probe**:
- ✓ backend_lang
- ✓ frontend_framework
- ✓ architecture_hint

**call_chain**:
- service=2, dao=2, query=0, total=3
- ✓ service_must_resolve_to
- ✓ dao_must_resolve_to

**strategy 합성 (DEFAULT 대비)**:
- follow_added: `api, app, composable, composables, entities, features, pages, services, shared, stores, widgets`
- skip_added: `assets, styles, theme`
- max_depth: 3
