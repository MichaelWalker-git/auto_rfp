'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DollarSign, TrendingUp, TrendingDown, Minus, Calculator } from 'lucide-react';
import type { PricingSection } from '@auto-rfp/core';

interface PricingCardProps {
  pricing?: PricingSection | null;
}

const getPositionIcon = (position: string) => {
  switch (position) {
    case 'LOW': return <TrendingDown className="h-4 w-4 text-green-500" />;
    case 'HIGH': return <TrendingUp className="h-4 w-4 text-red-500" />;
    default: return <Minus className="h-4 w-4 text-yellow-500" />;
  }
};

const getPositionColor = (position: string) => {
  switch (position) {
    case 'LOW': return 'bg-green-50 text-green-700 border-green-200';
    case 'HIGH': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  }
};

const getPositionText = (position: string) => {
  switch (position) {
    case 'LOW': return 'Highly Competitive';
    case 'HIGH': return 'Above Market';
    case 'COMPETITIVE': return 'Market Rate';
    default: return position;
  }
};

const getStrategyText = (strategy: string) => {
  switch (strategy) {
    case 'COST_PLUS': return 'Cost Plus';
    case 'FIXED_PRICE': return 'Fixed Price';
    case 'TIME_AND_MATERIALS': return 'Time & Materials';
    case 'COMPETITIVE_ANALYSIS': return 'Competitive Analysis';
    default: return strategy.replace(/_/g, ' ');
  }
};

export const PricingCard = ({ pricing }: PricingCardProps) => {
  if (!pricing) {
    return (
      <Card className="border-2">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            <CardTitle>Pricing Analysis</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border rounded-lg p-6 text-center">
            <Calculator className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Pricing analysis will be available after requirements are complete.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          <CardTitle>Pricing Analysis</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Price Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Total Price</p>
            <p className="text-2xl font-bold">${pricing.totalPrice.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Strategy</p>
            <Badge variant="outline" className="mt-1">
              {getStrategyText(pricing.strategy)}
            </Badge>
          </div>
        </div>

        {/* Competitive Position */}
        <div className="flex items-center justify-between p-3 rounded-lg border">
          <div className="flex items-center gap-2">
            {getPositionIcon(pricing.competitivePosition)}
            <span className="font-medium">Competitive Position</span>
          </div>
          <Badge className={getPositionColor(pricing.competitivePosition)}>
            {getPositionText(pricing.competitivePosition)}
          </Badge>
        </div>

        {/* Cost Breakdown */}
        <div className="space-y-3">
          <h4 className="font-medium">Cost Breakdown</h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center p-2 rounded bg-muted/20">
              <span className="text-sm font-medium">Labor Costs:</span>
              <span className="text-sm font-bold">${pricing.laborCostTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-2 rounded bg-muted/20">
              <span className="text-sm font-medium">Materials & Equipment:</span>
              <span className="text-sm font-bold">${pricing.materialCostTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-2 rounded bg-muted/20">
              <span className="text-sm font-medium">Indirect Costs:</span>
              <span className="text-sm font-bold">${pricing.indirectCostTotal.toLocaleString()}</span>
            </div>
            <div className="border-t pt-2">
              <div className="flex justify-between items-center p-2 rounded bg-blue-50 border border-blue-200">
                <span className="text-sm font-medium text-blue-800">Subtotal:</span>
                <span className="text-sm font-bold text-blue-800">
                  ${(pricing.laborCostTotal + pricing.materialCostTotal + pricing.indirectCostTotal).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center p-2 rounded bg-green-50 border border-green-200 mt-1">
                <span className="text-sm font-medium text-green-800">Profit ({pricing.profitMargin}%):</span>
                <span className="text-sm font-bold text-green-800">
                  ${(pricing.totalPrice - pricing.laborCostTotal - pricing.materialCostTotal - pricing.indirectCostTotal).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 rounded bg-primary/10 border border-primary/20 mt-2">
                <span className="font-medium text-primary">Total Price:</span>
                <span className="text-lg font-bold text-primary">${pricing.totalPrice.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Confidence */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
          <span className="text-sm font-medium">Price Confidence</span>
          <div className="flex items-center gap-2">
            <div className="w-24 bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all ${
                  pricing.priceConfidence >= 80 ? 'bg-green-500' : 
                  pricing.priceConfidence >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${pricing.priceConfidence}%` }}
              />
            </div>
            <span className={`text-sm font-medium ${
              pricing.priceConfidence >= 80 ? 'text-green-600' : 
              pricing.priceConfidence >= 60 ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {pricing.priceConfidence}%
            </span>
          </div>
        </div>

        {/* Competitive Advantages */}
        {pricing.competitiveAdvantages.length > 0 && (
          <div>
            <h4 className="font-medium text-green-700 mb-2">Competitive Advantages</h4>
            <ul className="text-sm space-y-1">
              {pricing.competitiveAdvantages.map((advantage, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-green-500 mt-1">•</span>
                  <span>{advantage}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pricing Risks */}
        {pricing.pricingRisks.length > 0 && (
          <div>
            <h4 className="font-medium text-red-700 mb-2">Pricing Risks</h4>
            <ul className="text-sm space-y-1">
              {pricing.pricingRisks.map((risk, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-red-500 mt-1">•</span>
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Basis of Estimate */}
        <div>
          <h4 className="font-medium mb-2">Basis of Estimate</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {pricing.basisOfEstimate}
          </p>
        </div>

        {/* Assumptions */}
        {pricing.assumptions.length > 0 && (
          <div>
            <h4 className="font-medium mb-2">Key Assumptions</h4>
            <ul className="text-sm space-y-1">
              {pricing.assumptions.map((assumption, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-muted-foreground mt-1">•</span>
                  <span>{assumption}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};