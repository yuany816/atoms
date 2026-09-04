import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.KnowledgeChunks import KnowledgechunksService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/KnowledgeChunks", tags=["KnowledgeChunks"])


# ---------- Pydantic Schemas ----------
class KnowledgechunksData(BaseModel):
    """Entity data schema (for create/update)"""
    file_id: int
    file_name: str = None
    chunk_index: int = None
    content: str
    embedding: str
    dim: int = None


class KnowledgechunksUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    file_id: Optional[int] = None
    file_name: Optional[str] = None
    chunk_index: Optional[int] = None
    content: Optional[str] = None
    embedding: Optional[str] = None
    dim: Optional[int] = None


class KnowledgechunksResponse(BaseModel):
    """Entity response schema"""
    id: int
    file_id: int
    file_name: Optional[str] = None
    chunk_index: Optional[int] = None
    content: str
    embedding: str
    dim: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class KnowledgechunksListResponse(BaseModel):
    """List response schema"""
    items: List[KnowledgechunksResponse]
    total: int
    skip: int
    limit: int


class KnowledgechunksBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[KnowledgechunksData]


class KnowledgechunksBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: KnowledgechunksUpdateData


class KnowledgechunksBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[KnowledgechunksBatchUpdateItem]


class KnowledgechunksBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=KnowledgechunksListResponse)
async def query_KnowledgeChunkss(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query KnowledgeChunkss with filtering, sorting, and pagination"""
    logger.debug(f"Querying KnowledgeChunkss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = KnowledgechunksService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
        )
        logger.debug(f"Found {result['total']} KnowledgeChunkss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid KnowledgeChunks query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying KnowledgeChunkss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=KnowledgechunksListResponse)
async def query_KnowledgeChunkss_all(
    query: str = Query(None, description='Query conditions as JSON, e.g. {"id":2} or {"id":{"$gte":2}}'),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query KnowledgeChunkss with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying KnowledgeChunkss: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = KnowledgechunksService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} KnowledgeChunkss")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invalid KnowledgeChunks query: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error querying KnowledgeChunkss: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=KnowledgechunksResponse)
async def get_KnowledgeChunks(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single KnowledgeChunks by ID"""
    logger.debug(f"Fetching KnowledgeChunks with id: {id}, fields={fields}")
    
    service = KnowledgechunksService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Knowledgechunks with id {id} not found")
            raise HTTPException(status_code=404, detail="Knowledgechunks not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching KnowledgeChunks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=KnowledgechunksResponse, status_code=201)
async def create_KnowledgeChunks(
    data: KnowledgechunksData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new KnowledgeChunks"""
    logger.debug(f"Creating new KnowledgeChunks with data: {data}")
    
    service = KnowledgechunksService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create KnowledgeChunks")
        
        logger.info(f"Knowledgechunks created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating KnowledgeChunks: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating KnowledgeChunks: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[KnowledgechunksResponse], status_code=201)
async def create_KnowledgeChunkss_batch(
    request: KnowledgechunksBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple KnowledgeChunkss in a single request"""
    logger.debug(f"Batch creating {len(request.items)} KnowledgeChunkss")
    
    service = KnowledgechunksService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} KnowledgeChunkss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[KnowledgechunksResponse])
async def update_KnowledgeChunkss_batch(
    request: KnowledgechunksBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple KnowledgeChunkss in a single request"""
    logger.debug(f"Batch updating {len(request.items)} KnowledgeChunkss")
    
    service = KnowledgechunksService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} KnowledgeChunkss successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=KnowledgechunksResponse)
async def update_KnowledgeChunks(
    id: int,
    data: KnowledgechunksUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing KnowledgeChunks"""
    logger.debug(f"Updating KnowledgeChunks {id} with data: {data}")

    service = KnowledgechunksService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Knowledgechunks with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Knowledgechunks not found")
        
        logger.info(f"Knowledgechunks {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating KnowledgeChunks {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating KnowledgeChunks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_KnowledgeChunkss_batch(
    request: KnowledgechunksBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple KnowledgeChunkss by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} KnowledgeChunkss")
    
    service = KnowledgechunksService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} KnowledgeChunkss successfully")
        return {"message": f"Successfully deleted {deleted_count} KnowledgeChunkss", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_KnowledgeChunks(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single KnowledgeChunks by ID"""
    logger.debug(f"Deleting KnowledgeChunks with id: {id}")
    
    service = KnowledgechunksService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Knowledgechunks with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Knowledgechunks not found")
        
        logger.info(f"Knowledgechunks {id} deleted successfully")
        return {"message": "Knowledgechunks deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting KnowledgeChunks {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")